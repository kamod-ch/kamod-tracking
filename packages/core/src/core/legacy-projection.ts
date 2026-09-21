import { hasBusinessObjectId, type TrackingEventEnvelope } from "./envelope";
import type { EventSubject, TrackingEvent } from "./types";

export const projectLegacyTrackingEvent = (envelope: TrackingEventEnvelope): TrackingEvent => {
  return {
    id: envelope.event_id,
    name: envelope.event_name,
    purpose: envelope.purpose,
    origin: envelope.producer,
    trust: envelope.trust_class,
    consent: envelope.consent,
    legalBasis: envelope.legalBasis,
    collectedAt: envelope.occurred_at,
    receivedAt: envelope.received_at,
    timeBounds: {},
    appId: envelope.site_id,
    subject: legacySubjectFrom(envelope),
    properties: envelope.properties,
  };
};

const legacySubjectFrom = (envelope: TrackingEventEnvelope): EventSubject => {
  if (envelope.session !== undefined) {
    return { type: "visitor", visitorId: envelope.session.sessionId };
  }
  if (hasBusinessObjectId(envelope.subject)) {
    return { type: "account", accountId: envelope.subject.objectId };
  }
  return { type: "none" };
};
