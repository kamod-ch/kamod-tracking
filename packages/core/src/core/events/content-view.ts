import { defineEvent, type EventRegistry } from "../registry";

export type ContentViewPropertiesV1 = {
  readonly path: string;
  readonly content_type: string;
};

export type ContentViewPropertiesV2 = {
  readonly path: string;
  readonly content_type: string;
  readonly section: string;
};

/** Neutral reference event shipped with the generic core. */
export const contentViewV1 = defineEvent<ContentViewPropertiesV1>({
  event_name: "content.view",
  schema_version: 1,
  producers: ["browser", "server"],
  privacyClass: "public",
  maxPayloadBytes: 2048,
  fields: [
    { kind: "path", key: "path", required: true },
    { kind: "string", key: "content_type", maxLength: 64, required: true },
  ],
  readableUntil: "2027-12-31T23:59:59.000Z",
});

export const contentViewV2 = defineEvent<ContentViewPropertiesV2>({
  event_name: "content.view",
  schema_version: 2,
  producers: ["browser", "server"],
  privacyClass: "public",
  maxPayloadBytes: 2048,
  fields: [
    { kind: "path", key: "path", required: true },
    { kind: "string", key: "content_type", maxLength: 64, required: true },
    { kind: "string", key: "section", maxLength: 64, required: true },
  ],
});

export const registerContentViewEvents = (registry: EventRegistry) => {
  registry.register(contentViewV1);
  registry.register(contentViewV2);
  return registry;
};
