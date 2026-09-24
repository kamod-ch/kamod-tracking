import type { JsonValue } from "../core/types";

const readSurfaceProperty = (payload: unknown): string | undefined => {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const record = payload as Record<string, JsonValue>;
  const top = record.surface;
  if (typeof top === "string") {
    return top;
  }
  const properties = record.properties;
  if (typeof properties === "object" && properties !== null && !Array.isArray(properties)) {
    const nested = (properties as Record<string, JsonValue>).surface;
    if (typeof nested === "string") {
      return nested;
    }
  }
  return undefined;
};

/** Maps payload surface to an allowlisted dimension value; never emits arbitrary JSON keys. */
export const resolveAllowlistedSurface = (
  payload: unknown,
  allowedSurfaces: readonly string[] | undefined,
): string => {
  if (!allowedSurfaces || allowedSurfaces.length === 0) {
    return "";
  }
  const allow = new Set(allowedSurfaces);
  const candidate = readSurfaceProperty(payload);
  if (candidate === undefined) {
    return "";
  }
  return allow.has(candidate) ? candidate : "";
};
