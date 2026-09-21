import { sanitizePath } from "./sanitize";
import type { JsonValue } from "./types";

export type FieldValidationError =
  | { readonly code: "missing"; readonly field: string }
  | { readonly code: "unknown"; readonly field: string }
  | { readonly code: "invalid"; readonly field: string; readonly detail: string }
  | { readonly code: "too_large"; readonly field: string };

export type PathField = {
  readonly kind: "path";
  readonly key: string;
  readonly required?: boolean;
};

export type ObjectIdField = {
  readonly kind: "objectId";
  readonly key: string;
  readonly required?: boolean;
};

export type StringField = {
  readonly kind: "string";
  readonly key: string;
  readonly maxLength: number;
  readonly required?: boolean;
};

export type IntegerField = {
  readonly kind: "integer";
  readonly key: string;
  readonly min?: number;
  readonly max?: number;
  readonly required?: boolean;
};

export type EventFieldDef = PathField | ObjectIdField | StringField | IntegerField;

const OBJECT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export const isValidObjectId = (value: string): boolean => OBJECT_ID_PATTERN.test(value);

export const isIsoTimestamp = (value: string): boolean => Number.isFinite(Date.parse(value));

export const validateEventFields = (
  fields: readonly EventFieldDef[],
  input: unknown,
  options: { readonly rejectUnknown: boolean },
):
  | { readonly ok: true; readonly properties: Record<string, JsonValue> }
  | { readonly ok: false; readonly errors: readonly FieldValidationError[] } => {
  if (input === undefined) {
    input = {};
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ code: "invalid", field: "properties", detail: "not an object" }],
    };
  }
  const raw = input as Record<string, unknown>;
  const allowed = new Set(fields.map((field) => field.key));
  const errors: FieldValidationError[] = [];

  if (options.rejectUnknown) {
    for (const key of Object.keys(raw)) {
      if (!allowed.has(key)) {
        errors.push({ code: "unknown", field: key });
      }
    }
  }

  const properties: Record<string, JsonValue> = {};

  for (const field of fields) {
    const value = raw[field.key];
    if (value === undefined) {
      if (field.required) {
        errors.push({ code: "missing", field: field.key });
      }
      continue;
    }
    switch (field.kind) {
      case "path": {
        if (typeof value !== "string") {
          errors.push({ code: "invalid", field: field.key, detail: "expected string path" });
          break;
        }
        properties[field.key] = sanitizePath(value);
        break;
      }
      case "objectId": {
        if (typeof value !== "string" || !isValidObjectId(value)) {
          errors.push({ code: "invalid", field: field.key, detail: "invalid object id" });
          break;
        }
        properties[field.key] = value;
        break;
      }
      case "string": {
        if (typeof value !== "string") {
          errors.push({ code: "invalid", field: field.key, detail: "expected string" });
          break;
        }
        if (value.length > field.maxLength) {
          errors.push({ code: "too_large", field: field.key });
          break;
        }
        properties[field.key] = value;
        break;
      }
      case "integer": {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          errors.push({ code: "invalid", field: field.key, detail: "expected integer" });
          break;
        }
        if (field.min !== undefined && value < field.min) {
          errors.push({ code: "invalid", field: field.key, detail: "below minimum" });
          break;
        }
        if (field.max !== undefined && value > field.max) {
          errors.push({ code: "invalid", field: field.key, detail: "above maximum" });
          break;
        }
        properties[field.key] = value;
        break;
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, properties };
};

export const payloadByteLength = (value: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};
