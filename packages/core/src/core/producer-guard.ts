import { FORBIDDEN_PRODUCER_FIELDS } from "./envelope";

export const stripForbiddenProducerFields = (
  record: Record<string, unknown>,
): Record<string, unknown> => {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if ((FORBIDDEN_PRODUCER_FIELDS as readonly string[]).includes(key)) {
      continue;
    }
    next[key] = value;
  }
  return next;
};

export const hasForbiddenProducerFields = (record: Record<string, unknown>): boolean =>
  FORBIDDEN_PRODUCER_FIELDS.some((field) => record[field] !== undefined);
