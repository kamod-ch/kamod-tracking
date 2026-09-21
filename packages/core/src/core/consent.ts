import type { ConsentRecord, ConsentState, ConsentStore, LegalBasis, Purpose } from "./types";

export const UNSPECIFIED_LEGAL_BASIS: LegalBasis = { kind: "unspecified" };

export const createMemoryConsentStore = (): ConsentStore => {
  const records = new Map<string, ConsentRecord>();

  return {
    get(appId, purpose) {
      return records.get(consentKey(appId, purpose));
    },
    set(appId, record) {
      records.set(consentKey(appId, record.purpose), record);
    },
  };
};

export const consentKey = (appId: string, purpose: Purpose): string => `${appId}:${purpose}`;

/**
 * Persist collection permission without touching legal basis.
 * Callers that need a legal basis must pass it explicitly; it is stored as declared, never inferred.
 */
export const recordConsent = (input: {
  store: ConsentStore;
  appId: string;
  purpose: Purpose;
  state: Exclude<ConsentState, "unknown">;
  recordedAt: string;
  legalBasis?: LegalBasis;
}): ConsentRecord => {
  const record: ConsentRecord = {
    purpose: input.purpose,
    state: input.state,
    recordedAt: input.recordedAt,
    legalBasis: input.legalBasis ?? UNSPECIFIED_LEGAL_BASIS,
  };
  input.store.set(input.appId, record);
  return record;
};

export const readConsentState = (
  store: ConsentStore,
  appId: string,
  purpose: Purpose,
): ConsentState => store.get(appId, purpose)?.state ?? "unknown";

export const isCollectionAllowed = (state: ConsentState, purpose: Purpose): boolean => {
  if (purpose === "necessary") return true;
  return state === "granted";
};
