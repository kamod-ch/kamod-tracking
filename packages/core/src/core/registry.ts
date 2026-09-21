import type { ProducerKind, PrivacyClass } from "./envelope";
import {
  payloadByteLength,
  validateEventFields,
  type EventFieldDef,
  type FieldValidationError,
} from "./schema-fields";

export type RegistryRejectReason =
  | "unknown-event"
  | "unknown-version"
  | "version-retired"
  | "producer-not-allowed"
  | "invalid-payload"
  | "payload-too-large";

export type EventDefinition<TProperties extends Record<string, unknown> = Record<string, unknown>> =
  {
    readonly event_name: string;
    readonly schema_version: number;
    readonly producers: readonly ProducerKind[];
    readonly privacyClass: PrivacyClass;
    readonly maxPayloadBytes: number;
    readonly fields: readonly EventFieldDef[];
    /** ISO timestamp until which stored events of this version remain readable. */
    readonly readableUntil?: string;
    readonly _properties?: TProperties;
  };

export type EventRegistry = {
  register<T extends EventDefinition>(definition: T): T;
  get(eventName: string, schemaVersion: number): EventDefinition | undefined;
  list(): readonly EventDefinition[];
  validateProperties(
    eventName: string,
    schemaVersion: number,
    properties: unknown,
  ):
    | { readonly ok: true; readonly properties: Record<string, import("./types").JsonValue> }
    | {
        readonly ok: false;
        readonly reason: RegistryRejectReason;
        readonly errors?: readonly FieldValidationError[];
      };
  isReadable(eventName: string, schemaVersion: number, at: Date): boolean;
};

export const defineEvent = <TProperties extends Record<string, unknown>>(
  definition: Omit<EventDefinition<TProperties>, "_properties">,
): EventDefinition<TProperties> => definition;

export const createEventRegistry = (): EventRegistry => {
  const definitions = new Map<string, EventDefinition>();

  const key = (eventName: string, schemaVersion: number) => `${eventName}@${schemaVersion}`;

  return {
    register(definition) {
      definitions.set(key(definition.event_name, definition.schema_version), definition);
      return definition;
    },
    get(eventName, schemaVersion) {
      return definitions.get(key(eventName, schemaVersion));
    },
    list() {
      return [...definitions.values()];
    },
    validateProperties(eventName, schemaVersion, properties) {
      const definition = definitions.get(key(eventName, schemaVersion));
      if (!definition) {
        const anyVersion = [...definitions.keys()].some((entry) =>
          entry.startsWith(`${eventName}@`),
        );
        return { ok: false, reason: anyVersion ? "unknown-version" : "unknown-event" };
      }
      if (payloadByteLength(properties) > definition.maxPayloadBytes) {
        return { ok: false, reason: "payload-too-large" };
      }
      const validated = validateEventFields(definition.fields, properties, {
        rejectUnknown: true,
      });
      if (!validated.ok) {
        return { ok: false, reason: "invalid-payload", errors: validated.errors };
      }
      return { ok: true, properties: validated.properties };
    },
    isReadable(eventName, schemaVersion, at) {
      const definition = definitions.get(key(eventName, schemaVersion));
      if (!definition) {
        return false;
      }
      if (definition.readableUntil === undefined) {
        return true;
      }
      return at.getTime() <= Date.parse(definition.readableUntil);
    },
  };
};

export type RegistryEventMap = Record<string, Record<number, Record<string, unknown>>>;

export type PropertiesFor<
  TMap extends RegistryEventMap,
  TName extends keyof TMap,
  TVersion extends keyof TMap[TName] & number,
> = TMap[TName][TVersion];
