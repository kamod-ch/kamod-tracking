import type { EventDefinition } from "./registry";
import type { Purpose } from "./types";

/** Server-side purpose binding for an event definition. Browser producers cannot override this. */
export const resolveEventCollectionPurpose = (definition: EventDefinition): Purpose =>
  definition.collectionPurpose;
