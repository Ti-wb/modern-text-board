import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STORAGE_KEYS,
  createDefaultPreferences,
  createDefaultWorkspace,
} from "./defaults";
import {
  commitImport,
  createExport,
  createWorkspaceAutosave,
  hydrateDomainData,
  loadWorkspace,
  savePreferences,
  saveWorkspace,
  type StorageLike,
} from "./storage";
import type { WorkspaceStorageEnvelopeV1 } from "./types";

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("local persistence", () => {
  it("hydrates defaults only when stored values are absent", () => {
    const storage = new MemoryStorage();
    const hydrated = hydrateDomainData("en", storage);
    expect(hydrated.workspace.pages[0].name).toBe("Page 1");
    expect(hydrated.preferences.locale).toBe("en");
    expect(hydrated.workspaceLoad.status).toBe("empty");
    expect(storage.values.size).toBe(0);
  });

  it("saves validated envelopes and increments revision only on success", () => {
    const storage = new MemoryStorage();
    const workspace = createDefaultWorkspace("en", "page-1");
    const result = saveWorkspace(workspace, {
      storage,
      writerId: "tab-a",
      revision: 4,
      now: () => new Date("2026-08-12T00:00:00.000Z"),
    });
    expect(result).toMatchObject({
      success: true,
      data: { revision: 5, writerId: "tab-a", workspace },
    });
    expect(loadWorkspace(storage)).toMatchObject({
      status: "ok",
      data: { revision: 5, workspace },
    });
  });

  it("retains invalid raw data for recovery instead of overwriting it", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.workspace, "{broken");
    const result = loadWorkspace(storage);
    expect(result).toMatchObject({
      status: "invalid",
      raw: "{broken",
      error: { code: "invalid_json" },
    });
    expect(storage.getItem(STORAGE_KEYS.workspace)).toBe("{broken");
  });

  it("falls back to memory mode when quota is exceeded", () => {
    const storage: StorageLike = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    const result = savePreferences(createDefaultPreferences(), {
      storage,
      writerId: "tab-a",
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: "quota_exceeded" },
    });
  });

  it("rolls back the first import write if the second write fails", () => {
    class WorkspaceWriteFailure extends MemoryStorage {
      failWorkspace = false;

      override setItem(key: string, value: string) {
        if (this.failWorkspace && key === STORAGE_KEYS.workspace) {
          throw new DOMException("full", "QuotaExceededError");
        }
        super.setItem(key, value);
      }
    }

    const storage = new WorkspaceWriteFailure();
    const oldPreferences = "old-preferences";
    storage.setItem(STORAGE_KEYS.preferences, oldPreferences);
    storage.failWorkspace = true;
    const result = commitImport(
      createExport(
        createDefaultWorkspace("en", "import-page"),
        createDefaultPreferences("en"),
      ),
      { storage, writerId: "tab-a" },
    );
    expect(result).toMatchObject({ success: false });
    expect(storage.getItem(STORAGE_KEYS.preferences)).toBe(oldPreferences);
  });
});

describe("workspace autosave and multi-tab conflicts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces writes for 300ms and supports a synchronous flush", () => {
    const storage = new MemoryStorage();
    const controller = createWorkspaceAutosave({
      storage,
      writerId: "tab-a",
      delayMs: 300,
    });
    const workspace = createDefaultWorkspace("en", "page-1");
    controller.schedule(workspace);
    vi.advanceTimersByTime(299);
    expect(storage.getItem(STORAGE_KEYS.workspace)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(storage.getItem(STORAGE_KEYS.workspace)).not.toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      status: "saved",
      dirty: false,
      revision: 1,
    });

    workspace.pages[0] = { ...workspace.pages[0], text: "flush now" };
    controller.schedule(workspace);
    expect(controller.flush()).toMatchObject({ success: true });
    expect(controller.getSnapshot().revision).toBe(2);
    controller.dispose();
  });

  it("applies clean external changes and pauses on dirty conflicts", () => {
    const storage = new MemoryStorage();
    const controller = createWorkspaceAutosave({
      storage,
      writerId: "tab-a",
      revision: 1,
    });
    const remoteWorkspace = createDefaultWorkspace("en", "remote");
    const remote: WorkspaceStorageEnvelopeV1 = {
      format: "simple-white-board/local-workspace",
      schemaVersion: 1,
      revision: 2,
      savedAt: "2026-08-12T00:00:00.000Z",
      writerId: "tab-b",
      workspace: remoteWorkspace,
    };
    expect(controller.receiveExternal(JSON.stringify(remote))).toMatchObject({
      kind: "apply",
      envelope: remote,
    });

    const localWorkspace = createDefaultWorkspace("en", "local");
    controller.schedule(localWorkspace);
    const newerRemote = { ...remote, revision: 3 };
    expect(controller.receiveExternal(JSON.stringify(newerRemote))).toMatchObject({
      kind: "conflict",
    });
    expect(controller.getSnapshot()).toMatchObject({ status: "conflict", dirty: true });
    expect(controller.resolveConflict("remote")).toEqual(remoteWorkspace);
    expect(controller.getSnapshot()).toMatchObject({
      status: "saved",
      dirty: false,
      revision: 3,
    });
  });

  it("treats same-revision writes from another writer as real updates", () => {
    const controller = createWorkspaceAutosave({
      storage: new MemoryStorage(),
      writerId: "tab-a",
      revision: 1,
    });
    const envelope: WorkspaceStorageEnvelopeV1 = {
      format: "simple-white-board/local-workspace",
      schemaVersion: 1,
      revision: 1,
      savedAt: "2026-08-12T00:00:00.000Z",
      writerId: "tab-b",
      workspace: createDefaultWorkspace("en", "remote"),
    };
    expect(controller.receiveExternal(JSON.stringify(envelope))).toMatchObject({
      kind: "apply",
    });
  });
});
