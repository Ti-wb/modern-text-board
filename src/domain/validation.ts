import * as v from "valibot";

import { LIMITS, SCHEMA_VERSION, codePointLength, utf8ByteLength } from "./defaults";
import type {
  ExportV1,
  ImportTransactionJournalV1,
  PreferencesStorageEnvelopeV1,
  PreferencesV1,
  WorkspaceStorageEnvelopeV1,
  WorkspaceV1,
} from "./types";

export type ValidationErrorCode =
  | "file_too_large"
  | "invalid_json"
  | "invalid_format"
  | "unsupported_version"
  | "invalid_data"
  | "workspace_too_large";

export interface DomainValidationError {
  code: ValidationErrorCode;
  message: string;
  issues?: string[];
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: DomainValidationError };

const nonEmptyString = v.pipe(v.string(), v.minLength(1));
const isoDateString = v.pipe(v.string(), v.isoTimestamp());
const nonNegativeInteger = v.pipe(
  v.number(),
  v.finite(),
  v.integer(),
  v.minValue(0),
);

const pageName = v.pipe(
  v.string(),
  v.check((value) => value.trim().length > 0, "Page name must not be blank"),
  v.check(
    (value) => codePointLength(value) <= LIMITS.maxPageNameCodePoints,
    `Page name must be at most ${LIMITS.maxPageNameCodePoints} code points`,
  ),
);

const boardText = v.pipe(
  v.string(),
  v.check(
    (value) => codePointLength(value) <= LIMITS.maxTextCodePoints,
    `Board text must be at most ${LIMITS.maxTextCodePoints} code points`,
  ),
);

const qrPayload = v.nullable(
  v.pipe(
    v.string(),
    v.check(
      (value) => utf8ByteLength(value) <= LIMITS.maxQrPayloadBytes,
      `QR payload must be at most ${LIMITS.maxQrPayloadBytes} UTF-8 bytes`,
    ),
  ),
);

export const BoardPageV1Schema = v.pipe(
  v.strictObject({
    id: nonEmptyString,
    name: pageName,
    text: boardText,
    theme: v.picklist(["light", "dark"]),
    textColor: v.union([
      v.literal("auto"),
      v.pipe(v.string(), v.regex(/^#[0-9a-f]{6}$/i, "Invalid hex color")),
    ]),
    fontFamily: v.picklist([
      "system-sans",
      "system-rounded",
      "system-serif",
      "system-mono",
    ]),
    maxFontSizePx: v.pipe(
      v.number(),
      v.finite(),
      v.integer(),
      v.minValue(LIMITS.minFontSizePx),
      v.maxValue(LIMITS.maxFontSizePx),
    ),
    fontWeight: v.picklist([300, 400, 700, 900]),
    textAlign: v.picklist(["left", "center", "right"]),
    mirrored: v.boolean(),
    marquee: v.strictObject({
      enabled: v.boolean(),
      direction: v.picklist(["left", "right", "up", "down"]),
      speed: v.pipe(
        v.number(),
        v.finite(),
        v.integer(),
        v.minValue(LIMITS.minMarqueeSpeed),
        v.maxValue(LIMITS.maxMarqueeSpeed),
      ),
    }),
    flashEnabled: v.boolean(),
    qr: v.strictObject({
      enabled: v.boolean(),
      payload: qrPayload,
    }),
  }),
  v.check(
    (page) =>
      !page.qr.enabled ||
      (page.qr.payload !== null && page.qr.payload.length > 0),
    "Enabled QR must have a non-empty payload",
  ),
);

export const WorkspaceV1Schema = v.pipe(
  v.strictObject({
    pages: v.pipe(
      v.array(BoardPageV1Schema),
      v.minLength(1),
      v.maxLength(LIMITS.maxPages),
    ),
    activePageId: nonEmptyString,
  }),
  v.check(
    (workspace) =>
      new Set(workspace.pages.map((page) => page.id)).size === workspace.pages.length,
    "Page IDs must be unique",
  ),
  v.check(
    (workspace) => workspace.pages.some((page) => page.id === workspace.activePageId),
    "Active page ID must refer to an existing page",
  ),
  v.check(
    (workspace) =>
      utf8ByteLength(JSON.stringify(workspace)) <= LIMITS.maxWorkspaceBytes,
    `Workspace must be at most ${LIMITS.maxWorkspaceBytes} UTF-8 bytes`,
  ),
);

export const PreferencesV1Schema = v.strictObject({
  locale: v.picklist(["zh-TW", "en"]),
  toolbar: v.strictObject({
    edge: v.picklist(["top", "bottom"]),
    offsetRatio: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1)),
    autoHide: v.boolean(),
  }),
  keepScreenAwake: v.boolean(),
  pauseAnimations: v.boolean(),
});

export const ExportV1Schema = v.strictObject({
  format: v.literal("simple-white-board"),
  schemaVersion: v.literal(SCHEMA_VERSION),
  exportedAt: isoDateString,
  workspace: WorkspaceV1Schema,
  preferences: PreferencesV1Schema,
});

export const WorkspaceStorageEnvelopeV1Schema = v.strictObject({
  format: v.literal("simple-white-board/local-workspace"),
  schemaVersion: v.literal(SCHEMA_VERSION),
  revision: nonNegativeInteger,
  savedAt: isoDateString,
  writerId: nonEmptyString,
  workspace: WorkspaceV1Schema,
});

export const PreferencesStorageEnvelopeV1Schema = v.strictObject({
  format: v.literal("simple-white-board/local-preferences"),
  schemaVersion: v.literal(SCHEMA_VERSION),
  revision: nonNegativeInteger,
  savedAt: isoDateString,
  writerId: nonEmptyString,
  preferences: PreferencesV1Schema,
});

export const ImportTransactionJournalV1Schema = v.strictObject({
  format: v.literal("simple-white-board/import-transaction"),
  schemaVersion: v.literal(SCHEMA_VERSION),
  transactionId: nonEmptyString,
  createdAt: isoDateString,
  previousWorkspace: v.nullable(v.string()),
  previousPreferences: v.nullable(v.string()),
});

function getIssueMessages(issues: readonly v.BaseIssue<unknown>[]): string[] {
  return issues.map((issue) => {
    const path = v.getDotPath(issue);
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

function validateWithSchema<T>(
  schema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
  input: unknown,
): ValidationResult<T> {
  const result = v.safeParse(schema, input, { abortEarly: false });
  if (result.success) {
    return { success: true, data: result.output as T };
  }

  return {
    success: false,
    error: {
      code: "invalid_data",
      message: "The data does not match the Simple White Board schema.",
      issues: getIssueMessages(result.issues),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkDiscriminator(
  input: unknown,
  expectedFormat: string,
): ValidationResult<Record<string, unknown>> {
  if (!isRecord(input) || input.format !== expectedFormat) {
    return {
      success: false,
      error: { code: "invalid_format", message: `Expected format "${expectedFormat}".` },
    };
  }

  if (input.schemaVersion !== SCHEMA_VERSION) {
    return {
      success: false,
      error: {
        code: "unsupported_version",
        message: `Unsupported schema version: ${String(input.schemaVersion)}.`,
      },
    };
  }

  return { success: true, data: input };
}

export function validateWorkspace(input: unknown): ValidationResult<WorkspaceV1> {
  const result = validateWithSchema<WorkspaceV1>(WorkspaceV1Schema, input);
  if (
    !result.success &&
    result.error.issues?.some((issue) => issue.includes("Workspace must be at most"))
  ) {
    return {
      success: false,
      error: { ...result.error, code: "workspace_too_large" },
    };
  }
  return result;
}

export function validatePreferences(input: unknown): ValidationResult<PreferencesV1> {
  return validateWithSchema<PreferencesV1>(PreferencesV1Schema, input);
}

export function validateExport(input: unknown): ValidationResult<ExportV1> {
  const header = checkDiscriminator(input, "simple-white-board");
  return header.success
    ? validateWithSchema<ExportV1>(ExportV1Schema, input)
    : header;
}

export function validateWorkspaceStorageEnvelope(
  input: unknown,
): ValidationResult<WorkspaceStorageEnvelopeV1> {
  const header = checkDiscriminator(input, "simple-white-board/local-workspace");
  return header.success
    ? validateWithSchema<WorkspaceStorageEnvelopeV1>(WorkspaceStorageEnvelopeV1Schema, input)
    : header;
}

export function validatePreferencesStorageEnvelope(
  input: unknown,
): ValidationResult<PreferencesStorageEnvelopeV1> {
  const header = checkDiscriminator(input, "simple-white-board/local-preferences");
  return header.success
    ? validateWithSchema<PreferencesStorageEnvelopeV1>(
        PreferencesStorageEnvelopeV1Schema,
        input,
      )
    : header;
}

export function validateImportTransactionJournal(
  input: unknown,
): ValidationResult<ImportTransactionJournalV1> {
  const header = checkDiscriminator(
    input,
    "simple-white-board/import-transaction",
  );
  return header.success
    ? validateWithSchema<ImportTransactionJournalV1>(
        ImportTransactionJournalV1Schema,
        input,
      )
    : header;
}

export function parseExportJson(json: string): ValidationResult<ExportV1> {
  if (utf8ByteLength(json) > LIMITS.maxImportFileBytes) {
    return {
      success: false,
      error: {
        code: "file_too_large",
        message: `Import files must be at most ${LIMITS.maxImportFileBytes} bytes.`,
      },
    };
  }

  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return {
      success: false,
      error: { code: "invalid_json", message: "The selected file is not valid JSON." },
    };
  }

  return validateExport(input);
}

export function parseStoredJson<T>(
  json: string,
  validate: (input: unknown) => ValidationResult<T>,
): ValidationResult<T> {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return {
      success: false,
      error: { code: "invalid_json", message: "Stored data is not valid JSON." },
    };
  }

  return validate(input);
}
