import {
  LIMITS,
  SCHEMA_VERSION,
  STORAGE_KEYS,
  createDefaultPreferences,
  createDefaultWorkspace,
  createId,
  utf8ByteLength,
} from "./defaults";
import type {
  ExportV1,
  ImportTransactionJournalV1,
  Locale,
  PreferencesStorageEnvelopeV1,
  PreferencesV1,
  WorkspaceStorageEnvelopeV1,
  WorkspaceV1,
} from "./types";
import {
  parseExportJson,
  parseStoredJson,
  validateExport,
  validateImportTransactionJournal,
  validatePreferences,
  validatePreferencesStorageEnvelope,
  validateWorkspace,
  validateWorkspaceStorageEnvelope,
  type DomainValidationError,
} from "./validation";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type StorageFailureCode =
  | "storage_unavailable"
  | "quota_exceeded"
  | "invalid_data"
  | "workspace_too_large";

export interface StorageFailure {
  code: StorageFailureCode;
  message: string;
  cause?: unknown;
  validationError?: DomainValidationError;
}

export type StorageLoadResult<T> =
  | { status: "empty" }
  | { status: "ok"; data: T; raw: string }
  | { status: "invalid"; error: DomainValidationError; raw: string }
  | { status: "unavailable"; error: StorageFailure };

export type StorageSaveResult<T> =
  | { success: true; data: T; raw: string }
  | { success: false; error: StorageFailure };

export interface SaveOptions {
  storage?: StorageLike | null;
  revision?: number;
  writerId: string;
  now?: () => Date;
}

export interface HydratedDomainData {
  workspace: WorkspaceV1;
  preferences: PreferencesV1;
  workspaceRevision: number;
  preferencesRevision: number;
  autosaveAllowed: boolean;
  workspaceLoad: StorageLoadResult<WorkspaceStorageEnvelopeV1>;
  preferencesLoad: StorageLoadResult<PreferencesStorageEnvelopeV1>;
}

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function storageFailure(cause: unknown): StorageFailure {
  const name =
    typeof cause === "object" && cause !== null && "name" in cause
      ? String((cause as { name?: unknown }).name)
      : "";
  const code =
    name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED"
      ? "quota_exceeded"
      : "storage_unavailable";
  return {
    code,
    message:
      code === "quota_exceeded"
        ? "Browser storage is full. Changes remain available in this tab only."
        : "Browser storage is unavailable. Changes remain available in this tab only.",
    cause,
  };
}

function loadEnvelope<T>(
  key: string,
  validate: (input: unknown) =>
    | { success: true; data: T }
    | { success: false; error: DomainValidationError },
  storage: StorageLike | null,
): StorageLoadResult<T> {
  if (storage === null) {
    return {
      status: "unavailable",
      error: storageFailure(new Error("localStorage is not available")),
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch (cause) {
    return { status: "unavailable", error: storageFailure(cause) };
  }

  if (raw === null) return { status: "empty" };
  const result = parseStoredJson(raw, validate);
  return result.success
    ? { status: "ok", data: result.data, raw }
    : { status: "invalid", error: result.error, raw };
}

export function loadWorkspace(
  storage: StorageLike | null = defaultStorage(),
): StorageLoadResult<WorkspaceStorageEnvelopeV1> {
  return loadEnvelope(STORAGE_KEYS.workspace, validateWorkspaceStorageEnvelope, storage);
}

export function loadPreferences(
  storage: StorageLike | null = defaultStorage(),
): StorageLoadResult<PreferencesStorageEnvelopeV1> {
  return loadEnvelope(
    STORAGE_KEYS.preferences,
    validatePreferencesStorageEnvelope,
    storage,
  );
}

export type ImportRecoveryResult =
  | { success: true; recovered: boolean }
  | { success: false; error: StorageFailure };

function restoreRawValue(
  storage: StorageLike,
  key: string,
  raw: string | null,
): void {
  if (raw === null) storage.removeItem(key);
  else storage.setItem(key, raw);
}

/**
 * Rolls back an import which did not reach its journal-removal commit point.
 * The journal is deliberately removed last, so recovery is safe to retry after
 * any individual localStorage operation fails.
 */
export function recoverImportTransaction(
  storage: StorageLike | null = defaultStorage(),
): ImportRecoveryResult {
  if (storage === null) {
    return {
      success: false,
      error: storageFailure(new Error("localStorage is not available")),
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEYS.importTransaction);
  } catch (cause) {
    return { success: false, error: storageFailure(cause) };
  }
  if (raw === null) return { success: true, recovered: false };

  const parsed = parseStoredJson(raw, validateImportTransactionJournal);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "invalid_data",
        message:
          "The pending import transaction is invalid, so stored board data cannot be trusted.",
        validationError: parsed.error,
      },
    };
  }

  try {
    restoreRawValue(
      storage,
      STORAGE_KEYS.preferences,
      parsed.data.previousPreferences,
    );
    restoreRawValue(
      storage,
      STORAGE_KEYS.workspace,
      parsed.data.previousWorkspace,
    );
    storage.removeItem(STORAGE_KEYS.importTransaction);
    return { success: true, recovered: true };
  } catch (cause) {
    // Keep the journal as the durable recovery marker. A later hydration can
    // retry the complete, idempotent rollback instead of trusting a partial pair.
    return { success: false, error: storageFailure(cause) };
  }
}

export function hydrateDomainData(
  locale: Locale = "zh-TW",
  storage: StorageLike | null = defaultStorage(),
): HydratedDomainData {
  const recovery = recoverImportTransaction(storage);
  if (!recovery.success) {
    const workspaceLoad: StorageLoadResult<WorkspaceStorageEnvelopeV1> = {
      status: "unavailable",
      error: recovery.error,
    };
    const preferencesLoad: StorageLoadResult<PreferencesStorageEnvelopeV1> = {
      status: "unavailable",
      error: recovery.error,
    };
    return {
      workspace: createDefaultWorkspace(locale),
      preferences: createDefaultPreferences(locale),
      workspaceRevision: 0,
      preferencesRevision: 0,
      autosaveAllowed: false,
      workspaceLoad,
      preferencesLoad,
    };
  }

  const workspaceLoad = loadWorkspace(storage);
  const preferencesLoad = loadPreferences(storage);
  return {
    workspace:
      workspaceLoad.status === "ok"
        ? workspaceLoad.data.workspace
        : createDefaultWorkspace(locale),
    preferences:
      preferencesLoad.status === "ok"
        ? preferencesLoad.data.preferences
        : createDefaultPreferences(locale),
    workspaceRevision: workspaceLoad.status === "ok" ? workspaceLoad.data.revision : 0,
    preferencesRevision:
      preferencesLoad.status === "ok" ? preferencesLoad.data.revision : 0,
    autosaveAllowed:
      (workspaceLoad.status === "empty" || workspaceLoad.status === "ok") &&
      (preferencesLoad.status === "empty" || preferencesLoad.status === "ok"),
    workspaceLoad,
    preferencesLoad,
  };
}

function persistEnvelope<T>(
  key: string,
  envelope: T,
  storage: StorageLike | null,
): StorageSaveResult<T> {
  if (storage === null) {
    return {
      success: false,
      error: storageFailure(new Error("localStorage is not available")),
    };
  }

  const raw = JSON.stringify(envelope);
  try {
    storage.setItem(key, raw);
    return { success: true, data: envelope, raw };
  } catch (cause) {
    return { success: false, error: storageFailure(cause) };
  }
}

function nextRevision(revision: number | undefined): number {
  return Number.isFinite(revision) && (revision ?? 0) >= 0
    ? Math.trunc(revision ?? 0) + 1
    : 1;
}

function invalidWriterResult<T>(): StorageSaveResult<T> {
  return {
    success: false,
    error: {
      code: "invalid_data",
      message: "A non-empty writer ID is required to save data.",
    },
  };
}

export function saveWorkspace(
  workspace: WorkspaceV1,
  options: SaveOptions,
): StorageSaveResult<WorkspaceStorageEnvelopeV1> {
  if (options.writerId.trim().length === 0) return invalidWriterResult();
  const validation = validateWorkspace(workspace);
  if (!validation.success) {
    return {
      success: false,
      error: {
        code:
          validation.error.code === "workspace_too_large"
            ? "workspace_too_large"
            : "invalid_data",
        message: validation.error.message,
        validationError: validation.error,
      },
    };
  }

  const envelope: WorkspaceStorageEnvelopeV1 = {
    format: "simple-white-board/local-workspace",
    schemaVersion: SCHEMA_VERSION,
    revision: nextRevision(options.revision),
    savedAt: (options.now ?? (() => new Date()))().toISOString(),
    writerId: options.writerId,
    workspace: validation.data,
  };
  return persistEnvelope(
    STORAGE_KEYS.workspace,
    envelope,
    options.storage === undefined ? defaultStorage() : options.storage,
  );
}

export function savePreferences(
  preferences: PreferencesV1,
  options: SaveOptions,
): StorageSaveResult<PreferencesStorageEnvelopeV1> {
  if (options.writerId.trim().length === 0) return invalidWriterResult();
  const validation = validatePreferences(preferences);
  if (!validation.success) {
    return {
      success: false,
      error: {
        code: "invalid_data",
        message: validation.error.message,
        validationError: validation.error,
      },
    };
  }

  const envelope: PreferencesStorageEnvelopeV1 = {
    format: "simple-white-board/local-preferences",
    schemaVersion: SCHEMA_VERSION,
    revision: Math.max(0, Math.trunc(options.revision ?? 0)) + 1,
    savedAt: (options.now ?? (() => new Date()))().toISOString(),
    writerId: options.writerId,
    preferences: validation.data,
  };
  return persistEnvelope(
    STORAGE_KEYS.preferences,
    envelope,
    options.storage === undefined ? defaultStorage() : options.storage,
  );
}

export function createExport(
  workspace: WorkspaceV1,
  preferences: PreferencesV1,
  now: Date = new Date(),
): ExportV1 {
  return {
    format: "simple-white-board",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    workspace,
    preferences,
  };
}

export function serializeExport(data: ExportV1, formatted = true): string {
  const result = validateExport(data);
  if (!result.success) {
    throw new TypeError(result.error.message);
  }
  return JSON.stringify(result.data, null, formatted ? 2 : undefined);
}

export function parseImport(json: string) {
  return parseExportJson(json);
}

export interface ImportCommitOptions {
  storage?: StorageLike | null;
  writerId: string;
  workspaceRevision?: number;
  preferencesRevision?: number;
  now?: () => Date;
}

export type ImportCommitResult =
  | {
      success: true;
      workspace: WorkspaceStorageEnvelopeV1;
      preferences: PreferencesStorageEnvelopeV1;
    }
  | { success: false; error: StorageFailure };

export function commitImport(
  data: ExportV1,
  options: ImportCommitOptions,
): ImportCommitResult {
  const validation = validateExport(data);
  if (!validation.success) {
    return {
      success: false,
      error: {
        code: "invalid_data",
        message: validation.error.message,
        validationError: validation.error,
      },
    };
  }
  if (options.writerId.trim().length === 0) {
    return {
      success: false,
      error: {
        code: "invalid_data",
        message: "A non-empty writer ID is required to save data.",
      },
    };
  }

  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (storage === null) {
    return {
      success: false,
      error: storageFailure(new Error("localStorage is not available")),
    };
  }

  const pendingRecovery = recoverImportTransaction(storage);
  if (!pendingRecovery.success) return pendingRecovery;

  let previousWorkspace: string | null;
  let previousPreferences: string | null;
  try {
    previousWorkspace = storage.getItem(STORAGE_KEYS.workspace);
    previousPreferences = storage.getItem(STORAGE_KEYS.preferences);
  } catch (cause) {
    return { success: false, error: storageFailure(cause) };
  }

  const now = options.now ?? (() => new Date());
  const savedAt = now().toISOString();
  const journal: ImportTransactionJournalV1 = {
    format: "simple-white-board/import-transaction",
    schemaVersion: SCHEMA_VERSION,
    transactionId: createId(),
    createdAt: savedAt,
    previousWorkspace,
    previousPreferences,
  };
  const savedJournal = persistEnvelope(
    STORAGE_KEYS.importTransaction,
    journal,
    storage,
  );
  if (!savedJournal.success) return savedJournal;

  const preferences: PreferencesStorageEnvelopeV1 = {
    format: "simple-white-board/local-preferences",
    schemaVersion: SCHEMA_VERSION,
    revision: nextRevision(options.preferencesRevision),
    savedAt,
    writerId: options.writerId,
    preferences: validation.data.preferences,
  };
  const savedPreferences = persistEnvelope(
    STORAGE_KEYS.preferences,
    preferences,
    storage,
  );
  if (!savedPreferences.success) {
    recoverImportTransaction(storage);
    return savedPreferences;
  }

  const workspace: WorkspaceStorageEnvelopeV1 = {
    format: "simple-white-board/local-workspace",
    schemaVersion: SCHEMA_VERSION,
    revision: nextRevision(options.workspaceRevision),
    savedAt,
    writerId: options.writerId,
    workspace: validation.data.workspace,
  };
  const savedWorkspace = persistEnvelope(STORAGE_KEYS.workspace, workspace, storage);
  if (!savedWorkspace.success) {
    recoverImportTransaction(storage);
    return savedWorkspace;
  }

  try {
    storage.removeItem(STORAGE_KEYS.importTransaction);
  } catch (cause) {
    const error = storageFailure(cause);
    recoverImportTransaction(storage);
    return { success: false, error };
  }

  return {
    success: true,
    workspace: savedWorkspace.data,
    preferences: savedPreferences.data,
  };
}

export function createWriterId(): string {
  return createId();
}

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "failed" | "conflict";

export interface AutosaveSnapshot {
  status: AutosaveStatus;
  dirty: boolean;
  revision: number;
  error?: StorageFailure;
  conflict?: WorkspaceStorageEnvelopeV1;
}

export interface WorkspaceAutosaveOptions {
  storage?: StorageLike | null;
  writerId: string;
  revision?: number;
  delayMs?: number;
  now?: () => Date;
  onChange?: (snapshot: AutosaveSnapshot) => void;
}

export interface WorkspaceAutosaveController {
  schedule(workspace: WorkspaceV1): void;
  flush(): StorageSaveResult<WorkspaceStorageEnvelopeV1> | null;
  cancel(): void;
  receiveExternal(raw: string): ExternalWorkspaceUpdate;
  resolveConflict(choice: "remote" | "local"): WorkspaceV1 | null;
  getSnapshot(): AutosaveSnapshot;
  dispose(): void;
}

export type ExternalWorkspaceUpdate =
  | { kind: "ignored" }
  | { kind: "invalid"; error: DomainValidationError }
  | { kind: "apply"; envelope: WorkspaceStorageEnvelopeV1 }
  | { kind: "conflict"; envelope: WorkspaceStorageEnvelopeV1 };

export function createWorkspaceAutosave(
  options: WorkspaceAutosaveOptions,
): WorkspaceAutosaveController {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const delayMs = options.delayMs ?? 300;
  let revision = Math.max(0, Math.trunc(options.revision ?? 0));
  let pending: WorkspaceV1 | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let status: AutosaveStatus = "idle";
  let error: StorageFailure | undefined;
  let conflict: WorkspaceStorageEnvelopeV1 | undefined;

  const snapshot = (): AutosaveSnapshot => ({
    status,
    dirty: pending !== null,
    revision,
    ...(error ? { error } : {}),
    ...(conflict ? { conflict } : {}),
  });

  const emit = () => options.onChange?.(snapshot());
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const controller: WorkspaceAutosaveController = {
    schedule(workspace) {
      pending = workspace;
      error = undefined;
      status = conflict ? "conflict" : "dirty";
      clearTimer();
      if (!conflict) {
        timer = setTimeout(() => controller.flush(), delayMs);
      }
      emit();
    },

    flush() {
      clearTimer();
      if (pending === null || conflict) return null;
      status = "saving";
      emit();
      const result = saveWorkspace(pending, {
        storage,
        writerId: options.writerId,
        revision,
        now: options.now,
      });
      if (result.success) {
        revision = result.data.revision;
        pending = null;
        error = undefined;
        status = "saved";
      } else {
        error = result.error;
        status = "failed";
      }
      emit();
      return result;
    },

    cancel() {
      clearTimer();
      pending = null;
      conflict = undefined;
      error = undefined;
      status = "idle";
      emit();
    },

    receiveExternal(raw) {
      const parsed = parseStoredJson(raw, validateWorkspaceStorageEnvelope);
      if (!parsed.success) return { kind: "invalid", error: parsed.error };
      const envelope = parsed.data;
      if (envelope.writerId === options.writerId || envelope.revision < revision) {
        return { kind: "ignored" };
      }
      if (pending !== null) {
        clearTimer();
        conflict = envelope;
        status = "conflict";
        emit();
        return { kind: "conflict", envelope };
      }
      revision = envelope.revision;
      status = "saved";
      emit();
      return { kind: "apply", envelope };
    },

    resolveConflict(choice) {
      if (!conflict) return null;
      const remote = conflict;
      conflict = undefined;
      revision = Math.max(revision, remote.revision);
      if (choice === "remote") {
        pending = null;
        error = undefined;
        status = "saved";
        emit();
        return remote.workspace;
      }
      status = pending ? "dirty" : "saved";
      if (pending) timer = setTimeout(() => controller.flush(), 0);
      emit();
      return null;
    },

    getSnapshot: snapshot,

    dispose() {
      clearTimer();
    },
  };

  return controller;
}

export function isImportFileSizeAllowed(size: number): boolean {
  return Number.isFinite(size) && size >= 0 && size <= LIMITS.maxImportFileBytes;
}

export function isWorkspaceSizeAllowed(workspace: WorkspaceV1): boolean {
  return utf8ByteLength(JSON.stringify(workspace)) <= LIMITS.maxWorkspaceBytes;
}
