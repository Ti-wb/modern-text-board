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

  it("hydrates legacy toolbar preferences without a vertical ratio", () => {
    const storage = new MemoryStorage();
    const legacyPreferences = {
      ...createDefaultPreferences("en"),
      toolbar: {
        edge: "top",
        offsetRatio: 0.2,
        autoHide: true,
      },
    };
    storage.setItem(
      STORAGE_KEYS.preferences,
      JSON.stringify({
        format: "simple-white-board/local-preferences",
        schemaVersion: 1,
        revision: 3,
        savedAt: "2026-08-12T00:00:00.000Z",
        writerId: "legacy-tab",
        preferences: legacyPreferences,
      }),
    );

    const hydrated = hydrateDomainData("zh-TW", storage);

    expect(hydrated.preferencesLoad.status).toBe("ok");
    expect(hydrated.preferencesRevision).toBe(3);
    expect(hydrated.preferences.toolbar).toEqual({
      ...legacyPreferences.toolbar,
      verticalOffsetRatio: 0,
    });
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

  it("recovers the old pair on hydration after the second write and rollback fail", () => {
    class InterruptedImportStorage extends MemoryStorage {
      armed = false;
      workspaceWriteFailed = false;

      override setItem(key: string, value: string) {
        if (this.armed && key === STORAGE_KEYS.workspace) {
          this.workspaceWriteFailed = true;
          throw new DOMException("full", "QuotaExceededError");
        }
        if (
          this.armed &&
          this.workspaceWriteFailed &&
          key === STORAGE_KEYS.preferences
        ) {
          throw new DOMException("blocked", "SecurityError");
        }
        super.setItem(key, value);
      }
    }

    const storage = new InterruptedImportStorage();
    const oldWorkspace = createDefaultWorkspace("en", "old-page");
    oldWorkspace.pages[0].text = "old board";
    const oldPreferences = createDefaultPreferences("en");
    expect(
      saveWorkspace(oldWorkspace, { storage, writerId: "old-tab", revision: 3 }),
    ).toMatchObject({ success: true });
    expect(
      savePreferences(oldPreferences, {
        storage,
        writerId: "old-tab",
        revision: 5,
      }),
    ).toMatchObject({ success: true });
    const oldWorkspaceRaw = storage.getItem(STORAGE_KEYS.workspace);
    const oldPreferencesRaw = storage.getItem(STORAGE_KEYS.preferences);

    const importedWorkspace = createDefaultWorkspace("zh-TW", "new-page");
    importedWorkspace.pages[0].text = "new board";
    const importedPreferences = createDefaultPreferences("zh-TW");
    importedPreferences.keepScreenAwake = true;
    storage.armed = true;
    const result = commitImport(
      createExport(importedWorkspace, importedPreferences),
      {
        storage,
        writerId: "import-tab",
        workspaceRevision: 4,
        preferencesRevision: 6,
      },
    );

    expect(result).toMatchObject({ success: false });
    expect(storage.getItem(STORAGE_KEYS.importTransaction)).not.toBeNull();
    expect(storage.getItem(STORAGE_KEYS.workspace)).toBe(oldWorkspaceRaw);
    expect(storage.getItem(STORAGE_KEYS.preferences)).not.toBe(oldPreferencesRaw);

    const blockedHydration = hydrateDomainData("zh-TW", storage);
    expect(blockedHydration.autosaveAllowed).toBe(false);
    expect(blockedHydration.workspaceLoad.status).toBe("unavailable");
    expect(blockedHydration.preferencesLoad.status).toBe("unavailable");
    expect(blockedHydration.preferences.keepScreenAwake).toBe(false);
    expect(storage.getItem(STORAGE_KEYS.importTransaction)).not.toBeNull();

    storage.armed = false;
    const hydrated = hydrateDomainData("zh-TW", storage);
    expect(hydrated.workspace).toEqual(oldWorkspace);
    expect(hydrated.preferences).toEqual(oldPreferences);
    expect(hydrated.workspaceRevision).toBe(4);
    expect(hydrated.preferencesRevision).toBe(6);
    expect(hydrated.autosaveAllowed).toBe(true);
    expect(storage.getItem(STORAGE_KEYS.workspace)).toBe(oldWorkspaceRaw);
    expect(storage.getItem(STORAGE_KEYS.preferences)).toBe(oldPreferencesRaw);
    expect(storage.getItem(STORAGE_KEYS.importTransaction)).toBeNull();
  });

  it("clears the import journal only after both imported envelopes are saved", () => {
    const storage = new MemoryStorage();
    const workspace = createDefaultWorkspace("en", "imported-page");
    workspace.pages[0].text = "imported";
    const preferences = createDefaultPreferences("en");

    const result = commitImport(createExport(workspace, preferences), {
      storage,
      writerId: "import-tab",
      workspaceRevision: 8,
      preferencesRevision: 10,
      now: () => new Date("2026-08-12T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      success: true,
      workspace: { revision: 9, workspace },
      preferences: { revision: 11, preferences },
    });
    expect(storage.getItem(STORAGE_KEYS.importTransaction)).toBeNull();
    expect(hydrateDomainData("zh-TW", storage)).toMatchObject({
      workspace,
      preferences,
      workspaceRevision: 9,
      preferencesRevision: 11,
      autosaveAllowed: true,
    });
  });

  it("imports legacy preferences and persists the normalized toolbar position", () => {
    const storage = new MemoryStorage();
    const workspace = createDefaultWorkspace("en", "legacy-import");
    const exported = createExport(
      workspace,
      createDefaultPreferences("en"),
      new Date("2026-08-12T12:00:00.000Z"),
    );
    const legacyExport = {
      ...exported,
      preferences: {
        ...exported.preferences,
        toolbar: {
          edge: "bottom",
          offsetRatio: 0.65,
          autoHide: false,
        },
      },
    };

    const result = commitImport(
      legacyExport as unknown as Parameters<typeof commitImport>[0],
      { storage, writerId: "import-tab" },
    );

    expect(result).toMatchObject({
      success: true,
      preferences: {
        preferences: {
          toolbar: {
            offsetRatio: 0.65,
            verticalOffsetRatio: 1,
          },
        },
      },
    });
    expect(hydrateDomainData("en", storage).preferences.toolbar).toMatchObject({
      offsetRatio: 0.65,
      verticalOffsetRatio: 1,
    });
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
