import type { PoolClient } from "pg";
import type { TrackingEventEnvelope } from "../core/envelope";
import { hashEnvelopePayload, payloadHashesEqual } from "./payload-hash";
import type { PostgresAcceptResult, PostgresScope } from "./scoped-store";

export const assertEnvelopeScope = (
  envelope: TrackingEventEnvelope,
  scope: PostgresScope,
): { readonly ok: false; readonly reason: "scope-mismatch" } | undefined => {
  if (envelope.tenant_id !== scope.tenantId || envelope.site_id !== scope.siteId) {
    return { ok: false, reason: "scope-mismatch" };
  }
  return undefined;
};

export const siteIsRegistered = async (
  client: PoolClient,
  scope: PostgresScope,
): Promise<boolean> => {
  const site = await client.query<{ ok: number }>(
    `SELECT 1 AS ok FROM tracking.sites WHERE tenant_id = $1 AND site_id = $2`,
    [scope.tenantId, scope.siteId],
  );
  return site.rowCount === 1;
};

/**
 * Writes inbox + events for one envelope on an open transaction.
 * Uses SAVEPOINT so payload-conflict rejects do not abort the surrounding batch transaction.
 * Throws on infrastructure errors (caller rolls back the whole batch).
 */
export const writeScopedEnvelopeInTransaction = async (
  client: PoolClient,
  scope: PostgresScope,
  envelope: TrackingEventEnvelope,
): Promise<PostgresAcceptResult> => {
  const mismatch = assertEnvelopeScope(envelope, scope);
  if (mismatch) {
    return mismatch;
  }

  await client.query("SAVEPOINT kamod_tracking_accept_env");

  try {
    const payloadHash = hashEnvelopePayload(envelope);
    const receivedAt = envelope.received_at;
    const insertInbox = await client.query(
      `INSERT INTO tracking.event_inbox (
         tenant_id, site_id, event_id, payload_hash, first_received_at, purpose
       ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6)
       ON CONFLICT (tenant_id, site_id, event_id) DO NOTHING
       RETURNING event_id`,
      [scope.tenantId, scope.siteId, envelope.event_id, payloadHash, receivedAt, envelope.purpose],
    );

    if (insertInbox.rowCount !== 1) {
      const existing = await client.query<{ payload_hash: Buffer }>(
        `SELECT payload_hash FROM tracking.event_inbox
         WHERE tenant_id = $1 AND site_id = $2 AND event_id = $3
         FOR UPDATE`,
        [scope.tenantId, scope.siteId, envelope.event_id],
      );
      const row = existing.rows[0];
      if (!row) {
        await client.query("ROLLBACK TO SAVEPOINT kamod_tracking_accept_env");
        return { ok: false, reason: "unknown-site" };
      }
      if (!payloadHashesEqual(row.payload_hash, payloadHash)) {
        await client.query("ROLLBACK TO SAVEPOINT kamod_tracking_accept_env");
        return { ok: false, reason: "payload-conflict" };
      }
      await client.query("RELEASE SAVEPOINT kamod_tracking_accept_env");
      return { ok: true, duplicate: true };
    }

    const subjectObjectId =
      envelope.subject.objectType === "none" ? null : envelope.subject.objectId;
    await client.query(
      `INSERT INTO tracking.events (
         tenant_id, site_id, event_id, schema_version, event_name,
         occurred_at, received_at, producer, trust_class,
         measurement_rule_version, collection_policy_version,
         purpose, consent_state, legal_basis, occurred_at_trust,
         subject_object_type, subject_object_id, session_id,
         payload, payload_hash
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6::timestamptz, $7::timestamptz, $8, $9,
         $10, $11,
         $12, $13, $14::jsonb, $15,
         $16, $17, $18,
         $19::jsonb, $20
       )`,
      [
        scope.tenantId,
        scope.siteId,
        envelope.event_id,
        envelope.schema_version,
        envelope.event_name,
        envelope.occurred_at,
        envelope.received_at,
        envelope.producer,
        envelope.trust_class,
        envelope.measurement_rule_version,
        envelope.collection_policy_version,
        envelope.purpose,
        envelope.consent,
        JSON.stringify(envelope.legalBasis),
        envelope.occurred_at_trust,
        envelope.subject.objectType,
        subjectObjectId,
        envelope.session?.sessionId ?? null,
        JSON.stringify(envelope),
        payloadHash,
      ],
    );
    await client.query("RELEASE SAVEPOINT kamod_tracking_accept_env");
    return { ok: true, duplicate: false };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT kamod_tracking_accept_env");
    throw error;
  }
};

export const postgresAcceptReasonToIngest = (
  reason: "payload-conflict" | "unknown-site" | "scope-mismatch",
): import("../core/types").IngestRejectReason => {
  if (reason === "payload-conflict") {
    return "payload-conflict";
  }
  return "unknown-app";
};
