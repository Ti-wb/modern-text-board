import * as v from "valibot";

import { LIMITS, SCHEMA_VERSION, codePointLength, utf8ByteLength } from "./defaults";
import type {
  ExportV2,
  ImportTransactionJournalV2,
  PreferencesStorageEnvelopeV2,
  PreferencesV2,
  WorkspaceStorageEnvelopeV2,
  WorkspaceV2,
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

const BoardPageV2InputSchema = v.strictObject({
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
  fontScalePercent: v.optional(
    v.nullable(
      v.pipe(
        v.number(),
        v.finite(),
        v.integer(),
        v.minValue(LIMITS.minFontScalePercent),
        v.maxValue(LIMITS.maxFontScalePercent),
      ),
    ),
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
      v.minValue(LIMITS.minMarqueeSpeed),
      v.maxValue(LIMITS.maxMarqueeSpeed),
    ),
  }),
  flashEnabled: v.boolean(),
  qr: v.strictObject({
    enabled: v.boolean(),
    payload: qrPayload,
  }),
});

export const BoardPageV2Schema = v.pipe(
  BoardPageV2InputSchema,
  v.transform((page) => ({
    ...page,
    fontScalePercent: page.fontScalePercent ?? null,
  })),
  v.check(
    (page) =>
      !page.qr.enabled ||
      (page.qr.payload !== null && page.qr.payload.length > 0),
    "Enabled QR must have a non-empty payload",
  ),
);

export const WorkspaceV2Schema = v.pipe(
  v.strictObject({
    pages: v.pipe(
      v.array(BoardPageV2Schema),
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

const ratio = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1));

const ToolbarPreferencesV2Schema = v.pipe(
  v.strictObject({
    edge: v.picklist(["top", "bottom"]),
    offsetRatio: ratio,
    verticalOffsetRatio: v.optional(ratio),
    autoHide: v.boolean(),
  }),
  v.transform((toolbar) => ({
    ...toolbar,
    verticalOffsetRatio:
      toolbar.verticalOffsetRatio ?? (toolbar.edge === "top" ? 0 : 1),
  })),
);

export const PreferencesV2Schema = v.strictObject({
  locale: v.picklist(["zh-TW", "en"]),
  toolbar: ToolbarPreferencesV2Schema,
  keepScreenAwake: v.boolean(),
  pauseAnimations: v.boolean(),
});

export const ExportV2Schema = v.strictObject({
  format: v.literal("simple-white-board"),
  schemaVersion: v.literal(SCHEMA_VERSION),
  exportedAt: isoDateString,
  workspace: WorkspaceV2Schema,
  preferences: PreferencesV2Schema,
});

export const WorkspaceStorageEnvelopeV2Schema = v.strictObject({
  format: v.literal("simple-white-board/local-workspace"),
  schemaVersion: v.literal(SCHEMA_VERSION),
  revision: nonNegativeInteger,
  savedAt: isoDateString,
  writerId: nonEmptyString,
  workspace: WorkspaceV2Schema,
});

export const PreferencesStorageEnvelopeV2Schema = v.strictObject({
  format: v.literal("simple-white-board/local-preferences"),
  schemaVersion: v.literal(SCHEMA_VERSION),
  revision: nonNegativeInteger,
  savedAt: isoDateString,
  writerId: nonEmptyString,
  preferences: PreferencesV2Schema,
});

export const ImportTransactionJournalV2Schema = v.strictObject({
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

  if (input.schemaVersion !== 1 && input.schemaVersion !== SCHEMA_VERSION) {
    return {
      success: false,
      error: {
        code: "unsupported_version",
        message: `Unsupported schema version: ${String(input.schemaVersion)}.`,
      },
    };
  }

  return {
    success: true,
    data:
      input.schemaVersion === SCHEMA_VERSION
        ? input
        : { ...input, schemaVersion: SCHEMA_VERSION },
  };
}

export function validateWorkspace(input: unknown): ValidationResult<WorkspaceV2> {
  const result = validateWithSchema<WorkspaceV2>(WorkspaceV2Schema, input);
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

export function validatePreferences(input: unknown): ValidationResult<PreferencesV2> {
  return validateWithSchema<PreferencesV2>(PreferencesV2Schema, input);
}

export function validateExport(input: unknown): ValidationResult<ExportV2> {
  const header = checkDiscriminator(input, "simple-white-board");
  return header.success
    ? validateWithSchema<ExportV2>(ExportV2Schema, header.data)
    : header;
}

export function validateWorkspaceStorageEnvelope(
  input: unknown,
): ValidationResult<WorkspaceStorageEnvelopeV2> {
  const header = checkDiscriminator(input, "simple-white-board/local-workspace");
  return header.success
    ? validateWithSchema<WorkspaceStorageEnvelopeV2>(WorkspaceStorageEnvelopeV2Schema, header.data)
    : header;
}

export function validatePreferencesStorageEnvelope(
  input: unknown,
): ValidationResult<PreferencesStorageEnvelopeV2> {
  const header = checkDiscriminator(input, "simple-white-board/local-preferences");
  return header.success
    ? validateWithSchema<PreferencesStorageEnvelopeV2>(
        PreferencesStorageEnvelopeV2Schema,
        header.data,
      )
    : header;
}

export function validateImportTransactionJournal(
  input: unknown,
): ValidationResult<ImportTransactionJournalV2> {
  const header = checkDiscriminator(
    input,
    "simple-white-board/import-transaction",
  );
  return header.success
    ? validateWithSchema<ImportTransactionJournalV2>(
        ImportTransactionJournalV2Schema,
        header.data,
      )
    : header;
}

export function parseExportJson(json: string): ValidationResult<ExportV2> {
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
