import { registerContentViewEvents } from "../../src/core/events/content-view";
import { createEventRegistry, defineEvent } from "../../src/core/registry";

export const createDevjobsRegistry = () => {
  const registry = createEventRegistry();
  registerContentViewEvents(registry);
  registry.register(
    defineEvent({
      event_name: "devjobs.listing.view",
      schema_version: 1,
      producers: ["browser"],
      privacyClass: "public",
      collectionPurpose: "measurement",
      maxPayloadBytes: 2048,
      fields: [
        { kind: "path", key: "path", required: true },
        { kind: "objectId", key: "listing_id", required: true },
        { kind: "string", key: "canton", maxLength: 8, required: true },
      ],
    }),
  );
  return registry;
};
