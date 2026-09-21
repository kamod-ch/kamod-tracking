import { createEventRegistry, defineEvent, registerContentViewEvents } from "@kamod-ch/tracking";

export type JobListingViewProperties = {
  readonly path: string;
  readonly listing_id: string;
  readonly canton: string;
};

export type JobApplyClickProperties = {
  readonly path: string;
  readonly listing_id: string;
};

export const jobListingViewV1 = defineEvent<JobListingViewProperties>({
  event_name: "devjobs.listing.view",
  schema_version: 1,
  producers: ["browser"],
  privacyClass: "public",
  maxPayloadBytes: 2048,
  fields: [
    { kind: "path", key: "path", required: true },
    { kind: "objectId", key: "listing_id", required: true },
    { kind: "string", key: "canton", maxLength: 8, required: true },
  ],
});

export const jobApplyClickV1 = defineEvent<JobApplyClickProperties>({
  event_name: "devjobs.apply.click",
  schema_version: 1,
  producers: ["browser"],
  privacyClass: "internal",
  maxPayloadBytes: 1024,
  fields: [
    { kind: "path", key: "path", required: true },
    { kind: "objectId", key: "listing_id", required: true },
  ],
});

export const createDevjobsRegistry = () => {
  const registry = createEventRegistry();
  registerContentViewEvents(registry);
  registry.register(jobListingViewV1);
  registry.register(jobApplyClickV1);
  return registry;
};
