import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { STORAGE_KEYS } from "../domain/defaults";
import {
  commitImport,
  createWriterId,
  savePreferences,
  saveWorkspace,
  type AutosaveSnapshot,
  type ImportCommitResult
} from "../domain/storage";
import type {
  ExportV1,
  PreferencesStorageEnvelopeV1,
  PreferencesV1,
  WorkspaceStorageEnvelopeV1,
  WorkspaceV1
} from "../domain/types";
import {
  parseStoredJson,
  validatePreferencesStorageEnvelope,
  validateWorkspaceStorageEnvelope
} from "../domain/validation";

interface PersistenceOptions {
  workspace: WorkspaceV1;
  preferences: PreferencesV1;
  initialWorkspaceRevision: number;
  initialPreferencesRevision: number;
  hydrated: boolean;
  onRemoteWorkspace: (workspace: WorkspaceV1) => void;
  onRemotePreferences: (preferences: PreferencesV1) => void;
}

const DELAY_MS = 300;

export function useDomainPersistence({
  workspace,
  preferences,
  initialWorkspaceRevision,
  initialPreferencesRevision,
  hydrated,
  onRemoteWorkspace,
  onRemotePreferences
}: PersistenceOptions) {
  const [writerId] = useState(createWriterId);
  const workspaceRef = useRef(workspace);
  const preferencesRef = useRef(preferences);
  const workspaceBaselineRef = useRef(workspace);
  const preferencesBaselineRef = useRef(preferences);
  const workspaceRevisionRef = useRef(initialWorkspaceRevision);
  const preferencesRevisionRef = useRef(initialPreferencesRevision);
  const workspaceDirtyRef = useRef(false);
  const preferencesDirtyRef = useRef(false);
  const workspaceTimerRef = useRef<number | null>(null);
  const preferencesTimerRef = useRef<number | null>(null);
  const suppressWorkspaceRef = useRef<WorkspaceV1 | null>(null);
  const suppressPreferencesRef = useRef<PreferencesV1 | null>(null);
  const workspaceConflictRef = useRef<WorkspaceStorageEnvelopeV1 | null>(null);
  const preferencesConflictRef = useRef<PreferencesStorageEnvelopeV1 | null>(null);
  const remoteWorkspaceCallbackRef = useRef(onRemoteWorkspace);
  const remotePreferencesCallbackRef = useRef(onRemotePreferences);
  const enabledRef = useRef(hydrated);
  const [persistenceEnabled, setPersistenceEnabled] = useState(hydrated);
  const [preferenceDirty, setPreferenceDirty] = useState(false);
  const [preferenceSaveFailed, setPreferenceSaveFailed] = useState(false);
  const [memoryMode, setMemoryMode] = useState(!hydrated);
  const [workspaceStatus, setWorkspaceStatus] = useState<AutosaveSnapshot>({
    status: "idle",
    dirty: false,
    revision: initialWorkspaceRevision
  });

  const enterMemoryMode = useCallback(() => {
    enabledRef.current = false;
    setPersistenceEnabled(false);
    setMemoryMode(true);
    if (workspaceTimerRef.current !== null) window.clearTimeout(workspaceTimerRef.current);
    if (preferencesTimerRef.current !== null) window.clearTimeout(preferencesTimerRef.current);
    workspaceTimerRef.current = null;
    preferencesTimerRef.current = null;
  }, []);

  useEffect(() => {
    remoteWorkspaceCallbackRef.current = onRemoteWorkspace;
    remotePreferencesCallbackRef.current = onRemotePreferences;
  }, [onRemotePreferences, onRemoteWorkspace]);

  const flushWorkspace = useCallback((): boolean => {
    if (workspaceTimerRef.current !== null) window.clearTimeout(workspaceTimerRef.current);
    workspaceTimerRef.current = null;
    if (!workspaceDirtyRef.current) return true;
    if (!enabledRef.current || workspaceConflictRef.current) return false;

    setWorkspaceStatus((current) => ({ ...current, status: "saving" }));
    const result = saveWorkspace(workspaceRef.current, {
      writerId,
      revision: workspaceRevisionRef.current
    });
    if (!result.success) {
      enterMemoryMode();
      setWorkspaceStatus({
        status: "failed",
        dirty: true,
        revision: workspaceRevisionRef.current,
        error: result.error
      });
      return false;
    }

    workspaceRevisionRef.current = result.data.revision;
    workspaceBaselineRef.current = workspaceRef.current;
    workspaceDirtyRef.current = false;
    setWorkspaceStatus({ status: "saved", dirty: false, revision: result.data.revision });
    return true;
  }, [enterMemoryMode, writerId]);

  const flushPreferences = useCallback((): boolean => {
    if (preferencesTimerRef.current !== null) window.clearTimeout(preferencesTimerRef.current);
    preferencesTimerRef.current = null;
    if (!preferencesDirtyRef.current) return true;
    if (!enabledRef.current || preferencesConflictRef.current) return false;

    const result = savePreferences(preferencesRef.current, {
      writerId,
      revision: preferencesRevisionRef.current
    });
    if (!result.success) {
      enterMemoryMode();
      setPreferenceSaveFailed(true);
      return false;
    }
    preferencesRevisionRef.current = result.data.revision;
    preferencesBaselineRef.current = preferencesRef.current;
    preferencesDirtyRef.current = false;
    setPreferenceDirty(false);
    setPreferenceSaveFailed(false);
    return true;
  }, [enterMemoryMode, writerId]);

  const flush = useCallback((): boolean => {
    const workspaceSaved = flushWorkspace();
    const preferencesSaved = flushPreferences();
    return workspaceSaved && preferencesSaved;
  }, [flushPreferences, flushWorkspace]);

  useEffect(() => {
    workspaceRef.current = workspace;
    if (suppressWorkspaceRef.current === workspace) {
      suppressWorkspaceRef.current = null;
      workspaceBaselineRef.current = workspace;
      return;
    }
    if (workspace === workspaceBaselineRef.current) return;
    workspaceDirtyRef.current = true;
    setWorkspaceStatus({
      status: workspaceConflictRef.current ? "conflict" : "dirty",
      dirty: true,
      revision: workspaceRevisionRef.current,
      ...(workspaceConflictRef.current ? { conflict: workspaceConflictRef.current } : {})
    });
    if (!enabledRef.current || workspaceConflictRef.current) return;
    if (workspaceTimerRef.current !== null) window.clearTimeout(workspaceTimerRef.current);
    workspaceTimerRef.current = window.setTimeout(flushWorkspace, DELAY_MS);
  }, [flushWorkspace, workspace]);

  useEffect(() => {
    preferencesRef.current = preferences;
    if (suppressPreferencesRef.current === preferences) {
      suppressPreferencesRef.current = null;
      preferencesBaselineRef.current = preferences;
      return;
    }
    if (preferences === preferencesBaselineRef.current) return;
    preferencesDirtyRef.current = true;
    setPreferenceDirty(true);
    if (!enabledRef.current || preferencesConflictRef.current) return;
    if (preferencesTimerRef.current !== null) window.clearTimeout(preferencesTimerRef.current);
    preferencesTimerRef.current = window.setTimeout(flushPreferences, DELAY_MS);
  }, [flushPreferences, preferences]);

  useEffect(() => {
    if (!persistenceEnabled) return;

    const applyRemoteWorkspace = (envelope: WorkspaceStorageEnvelopeV1) => {
      workspaceRevisionRef.current = envelope.revision;
      workspaceDirtyRef.current = false;
      workspaceBaselineRef.current = envelope.workspace;
      suppressWorkspaceRef.current = envelope.workspace;
      setWorkspaceStatus({ status: "saved", dirty: false, revision: envelope.revision });
      remoteWorkspaceCallbackRef.current(envelope.workspace);
    };
    const applyRemotePreferences = (envelope: PreferencesStorageEnvelopeV1) => {
      preferencesRevisionRef.current = envelope.revision;
      preferencesDirtyRef.current = false;
      preferencesBaselineRef.current = envelope.preferences;
      suppressPreferencesRef.current = envelope.preferences;
      setPreferenceDirty(false);
      remotePreferencesCallbackRef.current(envelope.preferences);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.newValue === null) return;
      if (event.key === STORAGE_KEYS.workspace) {
        const parsed = parseStoredJson(event.newValue, validateWorkspaceStorageEnvelope);
        if (!parsed.success || parsed.data.writerId === writerId) return;
        const envelope = parsed.data;
        if (envelope.revision < workspaceRevisionRef.current) return;
        const same = JSON.stringify(envelope.workspace) === JSON.stringify(workspaceRef.current);
        if (same) {
          workspaceRevisionRef.current = Math.max(workspaceRevisionRef.current, envelope.revision);
          return;
        }
        if (workspaceDirtyRef.current || envelope.revision === workspaceRevisionRef.current) {
          workspaceConflictRef.current = envelope;
          if (workspaceTimerRef.current !== null) window.clearTimeout(workspaceTimerRef.current);
          setWorkspaceStatus({
            status: "conflict",
            dirty: workspaceDirtyRef.current,
            revision: workspaceRevisionRef.current,
            conflict: envelope
          });
          return;
        }
        applyRemoteWorkspace(envelope);
      } else if (event.key === STORAGE_KEYS.preferences) {
        const parsed = parseStoredJson(event.newValue, validatePreferencesStorageEnvelope);
        if (!parsed.success || parsed.data.writerId === writerId) return;
        const envelope = parsed.data;
        if (envelope.revision < preferencesRevisionRef.current) return;
        const same = JSON.stringify(envelope.preferences) === JSON.stringify(preferencesRef.current);
        if (same) {
          preferencesRevisionRef.current = Math.max(preferencesRevisionRef.current, envelope.revision);
          return;
        }
        if (preferencesDirtyRef.current || envelope.revision === preferencesRevisionRef.current) {
          preferencesConflictRef.current = envelope;
          if (preferencesTimerRef.current !== null) window.clearTimeout(preferencesTimerRef.current);
          setWorkspaceStatus((current) => ({ ...current, status: "conflict" }));
          return;
        }
        applyRemotePreferences(envelope);
      }
    };
    const flushOnLifecycle = () => { flush(); };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", flushOnLifecycle);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", flushOnLifecycle);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush, persistenceEnabled, writerId]);

  const resolveConflict = useCallback((choice: "remote" | "local") => {
    const workspaceConflict = workspaceConflictRef.current;
    const preferencesConflict = preferencesConflictRef.current;
    workspaceConflictRef.current = null;
    preferencesConflictRef.current = null;

    if (workspaceConflict) {
      workspaceRevisionRef.current = Math.max(workspaceRevisionRef.current, workspaceConflict.revision);
      if (choice === "remote") {
        workspaceDirtyRef.current = false;
        workspaceBaselineRef.current = workspaceConflict.workspace;
        suppressWorkspaceRef.current = workspaceConflict.workspace;
        remoteWorkspaceCallbackRef.current(workspaceConflict.workspace);
      } else {
        workspaceDirtyRef.current = true;
        workspaceTimerRef.current = window.setTimeout(flushWorkspace, 0);
      }
    }
    if (preferencesConflict) {
      preferencesRevisionRef.current = Math.max(preferencesRevisionRef.current, preferencesConflict.revision);
      if (choice === "remote") {
        preferencesDirtyRef.current = false;
        preferencesBaselineRef.current = preferencesConflict.preferences;
        suppressPreferencesRef.current = preferencesConflict.preferences;
        setPreferenceDirty(false);
        remotePreferencesCallbackRef.current(preferencesConflict.preferences);
      } else {
        preferencesDirtyRef.current = true;
        preferencesTimerRef.current = window.setTimeout(flushPreferences, 0);
      }
    }
    setWorkspaceStatus({
      status: workspaceDirtyRef.current ? "dirty" : "saved",
      dirty: workspaceDirtyRef.current,
      revision: workspaceRevisionRef.current
    });
  }, [flushPreferences, flushWorkspace]);

  const commitReplacement = useCallback((data: ExportV1): ImportCommitResult => {
    if (workspaceTimerRef.current !== null) window.clearTimeout(workspaceTimerRef.current);
    if (preferencesTimerRef.current !== null) window.clearTimeout(preferencesTimerRef.current);
    const result = commitImport(data, {
      writerId,
      workspaceRevision: workspaceRevisionRef.current,
      preferencesRevision: preferencesRevisionRef.current
    });
    if (!result.success) return result;

    enabledRef.current = true;
    setPersistenceEnabled(true);
    setMemoryMode(false);
    workspaceRevisionRef.current = result.workspace.revision;
    preferencesRevisionRef.current = result.preferences.revision;
    workspaceDirtyRef.current = false;
    preferencesDirtyRef.current = false;
    workspaceConflictRef.current = null;
    preferencesConflictRef.current = null;
    workspaceBaselineRef.current = result.workspace.workspace;
    preferencesBaselineRef.current = result.preferences.preferences;
    suppressWorkspaceRef.current = result.workspace.workspace;
    suppressPreferencesRef.current = result.preferences.preferences;
    setPreferenceDirty(false);
    setPreferenceSaveFailed(false);
    setWorkspaceStatus({ status: "saved", dirty: false, revision: result.workspace.revision });
    remoteWorkspaceCallbackRef.current(result.workspace.workspace);
    remotePreferencesCallbackRef.current(result.preferences.preferences);
    return result;
  }, [writerId]);

  useEffect(() => () => {
    if (workspaceTimerRef.current !== null) window.clearTimeout(workspaceTimerRef.current);
    if (preferencesTimerRef.current !== null) window.clearTimeout(preferencesTimerRef.current);
  }, []);

  return {
    writerId,
    workspaceStatus,
    dirty: workspaceStatus.dirty || preferenceDirty,
    saveFailed: memoryMode || !persistenceEnabled || workspaceStatus.status === "failed" || preferenceSaveFailed,
    persistenceEnabled,
    flush,
    resolveConflict,
    commitReplacement
  };
}
