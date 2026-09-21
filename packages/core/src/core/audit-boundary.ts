/**
 * Audit events belong in an audit module (for Otok apps: `@kamod-ch/otok-audit`).
 * Tracking ingest must refuse them rather than store a parallel trail.
 */

export type AuditLike = {
  readonly channel?: string;
  readonly kind?: string;
  readonly name?: string;
};

export const isAuditEvent = (input: AuditLike): boolean => {
  if (input.channel === "audit" || input.kind === "audit") {
    return true;
  }
  const name = input.name ?? "";
  return name === "audit" || name.startsWith("audit.");
};
