import { act, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SCHEMA_VERSION,
  STORAGE_KEYS,
  createDefaultPreferences,
  createDefaultWorkspace
} from "../domain/defaults";
import { createExport } from "../domain/storage";
import type {
  PreferencesStorageEnvelopeV2,
  PreferencesV2,
  WorkspaceStorageEnvelopeV2,
  WorkspaceV2
} from "../domain/types";
import { useDomainPersistence } from "./useDomainPersistence";

interface HookProps {
  workspace: WorkspaceV2;
  preferences: PreferencesV2;
  initialWorkspaceRevision: number;
  initialPreferencesRevision: number;
  hydrated: boolean;
  onRemoteWorkspace: (workspace: WorkspaceV2) => void;
  onRemotePreferences: (preferences: PreferencesV2) => void;
}

function createProps(overrides: Partial<HookProps> = {}): HookProps {
  return {
    workspace: createDefaultWorkspace("en", "page-1"),
    preferences: createDefaultPreferences("en"),
    initialWorkspaceRevision: 0,
    initialPreferencesRevision: 0,
    hydrated: true,
    onRemoteWorkspace: vi.fn(),
    onRemotePreferences: vi.fn(),
    ...overrides
  };
}

function stored<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw) as T;
}

function dispatchStorage(key: string, value: unknown) {
  window.dispatchEvent(new StorageEvent("storage", {
    key,
    newValue: JSON.stringify(value),
    storageArea: localStorage
  }));
}

describe("useDomainPersistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("does not write initial hydrated state merely because the hook mounted", () => {
    const props = createProps();
    renderHook(() => useDomainPersistence(props));

    act(() => { vi.advanceTimersByTime(1_000); });

    expect(localStorage.getItem(STORAGE_KEYS.workspace)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.preferences)).toBeNull();
  });

  it("debounces local workspace and preference changes independently", () => {
    const initial = createProps({
      initialWorkspaceRevision: 4,
      initialPreferencesRevision: 7
    });
    const { rerender } = renderHook(
      (props: HookProps) => useDomainPersistence(props),
      { initialProps: initial }
    );
    const workspace = {
      ...initial.workspace,
      pages: [{ ...initial.workspace.pages[0], text: "Gate A" }]
    };
    const preferences = {
      ...initial.preferences,
      pauseAnimations: true
    };

    rerender({ ...initial, workspace, preferences });
    act(() => { vi.advanceTimersByTime(299); });
    expect(localStorage.getItem(STORAGE_KEYS.workspace)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.preferences)).toBeNull();

    act(() => { vi.advanceTimersByTime(1); });
    expect(stored<WorkspaceStorageEnvelopeV2>(STORAGE_KEYS.workspace)).toMatchObject({
      revision: 5,
      workspace
    });
    expect(stored<PreferencesStorageEnvelopeV2>(STORAGE_KEYS.preferences)).toMatchObject({
      revision: 8,
      preferences
    });
  });

  it("persists both toolbar position axes in one preference write", () => {
    const initial = createProps({ initialPreferencesRevision: 2 });
    const { rerender } = renderHook(
      (props: HookProps) => useDomainPersistence(props),
      { initialProps: initial }
    );
    const preferences = {
      ...initial.preferences,
      toolbar: {
        ...initial.preferences.toolbar,
        edge: "top" as const,
        offsetRatio: 0.15,
        verticalOffsetRatio: 0.35
      }
    };

    rerender({ ...initial, preferences });
    act(() => { vi.advanceTimersByTime(300); });

    expect(stored<PreferencesStorageEnvelopeV2>(STORAGE_KEYS.preferences)).toMatchObject({
      revision: 3,
      preferences: {
        toolbar: {
          offsetRatio: 0.15,
          verticalOffsetRatio: 0.35
        }
      }
    });
  });

  it("flushes pending workspace and preference changes synchronously on pagehide", () => {
    const initial = createProps();
    const { rerender } = renderHook(
      (props: HookProps) => useDomainPersistence(props),
      { initialProps: initial }
    );
    const workspace = {
      ...initial.workspace,
      pages: [{ ...initial.workspace.pages[0], text: "Leaving now" }]
    };
    const preferences = {
      ...initial.preferences,
      toolbar: { ...initial.preferences.toolbar, autoHide: true }
    };
    rerender({ ...initial, workspace, preferences });

    act(() => { window.dispatchEvent(new Event("pagehide")); });

    expect(stored<WorkspaceStorageEnvelopeV2>(STORAGE_KEYS.workspace)?.workspace).toEqual(workspace);
    expect(stored<PreferencesStorageEnvelopeV2>(STORAGE_KEYS.preferences)?.preferences).toEqual(preferences);
  });

  it("adopts a newer clean remote workspace without echo-saving it", () => {
    const onRemoteWorkspace = vi.fn();
    const initial = createProps({ onRemoteWorkspace });
    const { result, rerender } = renderHook(
      (props: HookProps) => useDomainPersistence(props),
      { initialProps: initial }
    );
    const remoteWorkspace = createDefaultWorkspace("en", "remote-page");
    remoteWorkspace.pages[0] = { ...remoteWorkspace.pages[0], text: "Remote sign" };
    const envelope: WorkspaceStorageEnvelopeV2 = {
      format: "simple-white-board/local-workspace",
      schemaVersion: SCHEMA_VERSION,
      revision: 1,
      savedAt: "2026-08-12T00:00:00.000Z",
      writerId: "remote-tab",
      workspace: remoteWorkspace
    };

    act(() => dispatchStorage(STORAGE_KEYS.workspace, envelope));
    expect(onRemoteWorkspace).toHaveBeenCalledWith(remoteWorkspace);
    const adoptedWorkspace = onRemoteWorkspace.mock.calls[0][0] as WorkspaceV2;
    rerender({ ...initial, workspace: adoptedWorkspace });
    act(() => { vi.advanceTimersByTime(500); });

    expect(localStorage.getItem(STORAGE_KEYS.workspace)).toBeNull();
    expect(result.current.workspaceStatus).toMatchObject({
      status: "saved",
      dirty: false,
      revision: 1
    });
  });

  it("treats a differing equal-revision remote workspace as a conflict", () => {
    const onRemoteWorkspace = vi.fn();
    const initial = createProps({
      initialWorkspaceRevision: 3,
      onRemoteWorkspace
    });
    const { result } = renderHook(
      (props: HookProps) => useDomainPersistence(props),
      { initialProps: initial }
    );
    const remoteWorkspace = createDefaultWorkspace("en", "other-page");
    const envelope: WorkspaceStorageEnvelopeV2 = {
      format: "simple-white-board/local-workspace",
      schemaVersion: SCHEMA_VERSION,
      revision: 3,
      savedAt: "2026-08-12T00:00:00.000Z",
      writerId: "remote-tab",
      workspace: remoteWorkspace
    };

    act(() => dispatchStorage(STORAGE_KEYS.workspace, envelope));

    expect(onRemoteWorkspace).not.toHaveBeenCalled();
    expect(result.current.workspaceStatus).toMatchObject({
      status: "conflict",
      dirty: false,
      revision: 3,
      conflict: envelope
    });
  });

  it("commitReplacement recovers disabled persistence and adopts committed revisions", () => {
    const onRemoteWorkspace = vi.fn();
    const onRemotePreferences = vi.fn();
    const initial = createProps({
      hydrated: false,
      initialWorkspaceRevision: 7,
      initialPreferencesRevision: 9,
      onRemoteWorkspace,
      onRemotePreferences
    });
    const { result, rerender } = renderHook(
      (props: HookProps) => useDomainPersistence(props),
      { initialProps: initial }
    );
    const replacementWorkspace = createDefaultWorkspace("zh-TW", "imported-page");
    const replacementPreferences = createDefaultPreferences("zh-TW");

    act(() => {
      const commit = result.current.commitReplacement(
        createExport(replacementWorkspace, replacementPreferences)
      );
      expect(commit).toMatchObject({
        success: true,
        workspace: { revision: 8 },
        preferences: { revision: 10 }
      });
    });
    expect(result.current.persistenceEnabled).toBe(true);
    expect(result.current.saveFailed).toBe(false);
    expect(onRemoteWorkspace).toHaveBeenCalledWith(replacementWorkspace);
    expect(onRemotePreferences).toHaveBeenCalledWith(replacementPreferences);

    rerender({
      ...initial,
      workspace: replacementWorkspace,
      preferences: replacementPreferences
    });
    const changedWorkspace = {
      ...replacementWorkspace,
      pages: [{ ...replacementWorkspace.pages[0], text: "After import" }]
    };
    const changedPreferences = {
      ...replacementPreferences,
      keepScreenAwake: true
    };
    rerender({
      ...initial,
      workspace: changedWorkspace,
      preferences: changedPreferences
    });
    act(() => { vi.advanceTimersByTime(300); });

    expect(stored<WorkspaceStorageEnvelopeV2>(STORAGE_KEYS.workspace)?.revision).toBe(9);
    expect(stored<PreferencesStorageEnvelopeV2>(STORAGE_KEYS.preferences)?.revision).toBe(11);
  });

  it("enters memory mode after a workspace write fails and retries only after a successful replacement", () => {
    const initial = createProps();
    const { result, rerender } = renderHook(
      (props: HookProps) => useDomainPersistence(props),
      { initialProps: initial }
    );
    const nativeSetItem = Storage.prototype.setItem;
    let workspaceAttempts = 0;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === STORAGE_KEYS.workspace) {
        workspaceAttempts += 1;
        throw new DOMException("full", "QuotaExceededError");
      }
      nativeSetItem.call(this, key, value);
    });
    const firstChange = {
      ...initial.workspace,
      pages: [{ ...initial.workspace.pages[0], text: "First local change" }]
    };
    rerender({ ...initial, workspace: firstChange });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(workspaceAttempts).toBe(1);
    expect(result.current.persistenceEnabled).toBe(false);
    expect(result.current.saveFailed).toBe(true);
    expect(result.current.workspaceStatus).toMatchObject({ status: "failed", dirty: true });

    const secondChange = {
      ...firstChange,
      pages: [{ ...firstChange.pages[0], text: "Must remain in memory" }]
    };
    rerender({ ...initial, workspace: secondChange });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(workspaceAttempts).toBe(1);

    setItem.mockRestore();
    const replacementWorkspace = createDefaultWorkspace("en", "recovered-page");
    const replacementPreferences = createDefaultPreferences("en");
    act(() => {
      expect(result.current.commitReplacement(
        createExport(replacementWorkspace, replacementPreferences)
      )).toMatchObject({ success: true });
    });
    expect(result.current.persistenceEnabled).toBe(true);
    expect(result.current.saveFailed).toBe(false);

    const adoptedWorkspace = (initial.onRemoteWorkspace as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as WorkspaceV2;
    const adoptedPreferences = (initial.onRemotePreferences as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as PreferencesV2;
    rerender({
      ...initial,
      workspace: adoptedWorkspace,
      preferences: adoptedPreferences
    });
    const recoveredChange = {
      ...adoptedWorkspace,
      pages: [{ ...adoptedWorkspace.pages[0], text: "Persistence works again" }]
    };
    rerender({
      ...initial,
      workspace: recoveredChange,
      preferences: adoptedPreferences
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(stored<WorkspaceStorageEnvelopeV2>(STORAGE_KEYS.workspace)?.workspace).toEqual(recoveredChange);
  });

  it("enters memory mode after a preference write fails and does not retry later changes", () => {
    const initial = createProps();
    const { result, rerender } = renderHook(
      (props: HookProps) => useDomainPersistence(props),
      { initialProps: initial }
    );
    const nativeSetItem = Storage.prototype.setItem;
    let preferenceAttempts = 0;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === STORAGE_KEYS.preferences) {
        preferenceAttempts += 1;
        throw new DOMException("blocked", "SecurityError");
      }
      nativeSetItem.call(this, key, value);
    });
    const firstChange = { ...initial.preferences, pauseAnimations: true };
    rerender({ ...initial, preferences: firstChange });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(preferenceAttempts).toBe(1);
    expect(result.current.persistenceEnabled).toBe(false);
    expect(result.current.saveFailed).toBe(true);
    expect(result.current.dirty).toBe(true);

    const secondChange = { ...firstChange, keepScreenAwake: true };
    rerender({ ...initial, preferences: secondChange });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(preferenceAttempts).toBe(1);
    setItem.mockRestore();
  });
});
