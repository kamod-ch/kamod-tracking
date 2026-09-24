/**
 * Application-owned transactional outbox + worker (in-memory stand-in for PostgreSQL).
 * The SDK validates server events; your worker delivers them to tracking storage.
 */
import {
  createEventRegistry,
  registerContentViewEvents,
  recordConsent,
  createMemoryConsentStore,
} from "@kamod-ch/tracking";
import {
  createMemoryBatchEnvelopeAcceptance,
  createResettableMemoryEnvelopeStore,
  createServerCollectHandler,
  eventIdFromOutboxId,
  prepareValidatedOutboxEnvelope,
} from "@kamod-ch/tracking/server";

const collectorContext = {
  tenantId: "tenant_example",
  siteId: "site_example",
  measurementRuleVersion: "mr_v1",
  collectionPolicyVersion: "none",
  allowedBrowserIdentityModes: ["none"],
  browserIdentityMode: "none",
};

const site = {
  publicKey: "pk_example",
  tenantId: collectorContext.tenantId,
  siteId: collectorContext.siteId,
  appId: "app-example",
  collector: collectorContext,
  allowedOrigins: ["https://app.example"],
  browserIdentityMode: "none",
};

const registry = createEventRegistry();
registerContentViewEvents(registry);
const consents = createMemoryConsentStore();
recordConsent({
  store: consents,
  appId: site.appId,
  purpose: "analytics",
  state: "granted",
  recordedAt: "2026-09-21T12:00:00.000Z",
});

/** Simulated app tables (replace with your DB client). */
const jobs = new Map();
const outbox = [];
const quarantine = [];
const leases = new Map();

const LEASE_MS = 30_000;

const createJobWithOutboxEntry = ({ jobId, title, rollback }) => {
  if (jobs.has(jobId)) {
    throw new Error("job-exists");
  }
  if (rollback) {
    throw new Error("domain-rollback");
  }
  jobs.set(jobId, { jobId, title });
  outbox.push({
    outboxId: `job_created_${jobId}`,
    status: "pending",
    attempts: 0,
    leaseUntil: null,
    workerId: null,
    payload: {
      eventName: "content.view",
      schemaVersion: 1,
      occurredAt: "2026-09-21T12:00:00.000Z",
      subject: { objectType: "listing", objectId: jobId },
      properties: { path: `/jobs/${jobId}`, content_type: "listing" },
    },
  });
};

try {
  createJobWithOutboxEntry({ jobId: "job_fail", title: "Rollback", rollback: true });
} catch {
  // expected domain rollback — no job, no outbox row
}
if (jobs.size !== 0 || outbox.length !== 0) {
  throw new Error("rollback should leave no job/outbox rows");
}

createJobWithOutboxEntry({ jobId: "job_42", title: "Engineer", rollback: false });

const trackingStore = createResettableMemoryEnvelopeStore();
const contractOptions = () => ({
  appId: site.appId,
  registry,
  collector: collectorContext,
  envelopeStore: trackingStore,
  consents,
  clock: { now: () => new Date("2026-09-21T12:00:00.000Z") },
});

const batchAcceptance = createMemoryBatchEnvelopeAcceptance(trackingStore);

const claimNext = (workerId) => {
  const now = Date.now();
  for (const entry of outbox) {
    if (entry.status === "published" || entry.status === "quarantined") continue;
    if (entry.leaseUntil !== null && entry.leaseUntil > now && entry.workerId !== workerId) {
      continue;
    }
    entry.status = "processing";
    entry.workerId = workerId;
    entry.leaseUntil = now + LEASE_MS;
    leases.set(entry.outboxId, workerId);
    return entry;
  }
  return undefined;
};

const deliverEntry = async (entry, { crashAfterCommit }) => {
  const record = {
    outboxId: entry.outboxId,
    ...entry.payload,
  };
  const prepared = await prepareValidatedOutboxEnvelope(site, contractOptions(), record);
  if (!prepared.ok) {
    entry.status = "quarantined";
    quarantine.push({ outboxId: entry.outboxId, reason: prepared.reason });
    return { ok: false, permanent: true, reason: prepared.reason };
  }
  const stored = await batchAcceptance.acceptBatch([prepared.envelope]);
  if (!stored.ok) {
    entry.status = "failed";
    entry.attempts += 1;
    entry.leaseUntil = null;
    return { ok: false, permanent: false, reason: "storage-error" };
  }
  const outcome = stored.outcomes[0];
  if (outcome?.status === "rejected") {
    entry.status = "quarantined";
    quarantine.push({ outboxId: entry.outboxId, reason: outcome.reason });
    return { ok: false, permanent: true, reason: outcome.reason };
  }
  if (crashAfterCommit) {
    throw new Error("worker-crash-after-commit");
  }
  entry.status = "published";
  entry.leaseUntil = null;
  return { ok: true, duplicate: outcome?.status === "accepted" ? outcome.duplicate : false };
};

const workerId = "worker_1";
const first = claimNext(workerId);
if (!first) throw new Error("expected outbox entry");
const crashed = await deliverEntry(first, { crashAfterCommit: true }).catch((error) => error);
if (!(crashed instanceof Error) || crashed.message !== "worker-crash-after-commit") {
  throw new Error("expected simulated worker crash after tracking commit");
}
if (trackingStore.list().length !== 1) {
  throw new Error("tracking row must survive worker crash after commit");
}

const replay = claimNext(workerId);
if (!replay || replay.outboxId !== first.outboxId) {
  throw new Error("expected same entry after lease reclaim");
}
const secondDelivery = await deliverEntry(replay, { crashAfterCommit: false });
if (!secondDelivery.ok || !secondDelivery.duplicate) {
  throw new Error("double replay must be duplicate-safe");
}

const invalid = {
  outboxId: "job_created_invalid",
  status: "pending",
  attempts: 0,
  leaseUntil: null,
  workerId: null,
  payload: {
    eventName: "not.registered",
    schemaVersion: 1,
    occurredAt: "2026-09-21T12:00:00.000Z",
    subject: { objectType: "none" },
    properties: { path: "/x", content_type: "x" },
  },
};
outbox.push(invalid);
const bad = claimNext(workerId);
const quarantined = await deliverEntry(bad, { crashAfterCommit: false });
if (quarantined.ok || !quarantined.permanent) {
  throw new Error("invalid registry event must be quarantined");
}
if (quarantine.length < 1) {
  throw new Error("quarantine bucket must hold permanent failures");
}

const handler = createServerCollectHandler({
  auth: { kind: "static-token", token: "server-secret", site },
  createContractOptions: contractOptions,
  batchAcceptance,
});

const forgedBrowser = await handler(
  new Request("https://internal.example/v1/server-events", {
    method: "POST",
    headers: {
      authorization: "Bearer server-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      outboxId: "direct_http",
      eventName: "content.view",
      schemaVersion: 1,
      occurredAt: "2026-09-21T12:00:00.000Z",
      subject: { objectType: "none" },
      properties: { path: "/direct", content_type: "page" },
      producer: "browser",
    }),
  }),
);
if (forgedBrowser.status !== 403) {
  throw new Error("forged browser producer must be rejected on server collect path");
}

console.log("domain-outbox-worker example: ok", {
  jobId: "job_42",
  trackingEventId: eventIdFromOutboxId(first.outboxId),
  published: replay.status,
});
