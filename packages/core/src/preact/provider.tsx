import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import type { BrowserClient } from "../browser/client";
import {
  createDefaultIntersectionObserverFactory,
  createVisibilityImpressionObserver,
} from "../browser/visibility-observer";
import type { ConsentState, Purpose } from "../core/types";
import { TrackingContext, type TrackingContextValue, type TrackingVisibility } from "./context";

export type TrackingProviderProps = {
  /**
   * Stable browser client instance. The app creates and owns it; call `destroy()` when the shell unmounts.
   * Alias: `tracker` (legacy).
   */
  readonly client?: BrowserClient;
  readonly tracker?: BrowserClient;
  readonly children: ComponentChildren;
  /** Synced when changed; does not recreate the client. */
  readonly networkSendingEnabled?: boolean;
  readonly analyticsConsent?: Exclude<ConsentState, "unknown">;
  readonly measurementConsent?: Exclude<ConsentState, "unknown">;
};

const syncConsent = (
  client: BrowserClient,
  purpose: Purpose,
  state: Exclude<ConsentState, "unknown"> | undefined,
): void => {
  if (state === undefined) {
    return;
  }
  if (state === "denied") {
    client.revokeCapture(purpose);
    return;
  }
  client.setConsent(purpose, state);
};

export const TrackingProvider = ({
  client: clientProp,
  tracker,
  children,
  networkSendingEnabled,
  analyticsConsent,
  measurementConsent,
}: TrackingProviderProps) => {
  const client = clientProp ?? tracker;
  if (!client) {
    throw new Error("<TrackingProvider> requires a `client` (or legacy `tracker`) prop.");
  }

  const observerRef = useRef<ReturnType<typeof createVisibilityImpressionObserver> | undefined>(
    undefined,
  );
  const clientRef = useRef(client);
  clientRef.current = client;

  const ensureObserver = (): ReturnType<typeof createVisibilityImpressionObserver> | undefined => {
    if (observerRef.current) {
      return observerRef.current;
    }
    const createIntersectionObserver = createDefaultIntersectionObserverFactory();
    observerRef.current = createVisibilityImpressionObserver({
      lifecycle: clientRef.current.getViewLifecycle(),
      ...(createIntersectionObserver !== undefined ? { createIntersectionObserver } : {}),
    });
    return observerRef.current;
  };

  const visibility = useMemo((): TrackingVisibility => {
    return {
      observe(target, options) {
        const observer = ensureObserver();
        if (!observer) {
          return { disconnect() {} };
        }
        return observer.observe(target, options);
      },
      confirmImpression(subjectKey) {
        ensureObserver()?.confirmImpression(subjectKey);
      },
      cancelImpression(subjectKey) {
        ensureObserver()?.cancelImpression(subjectKey);
      },
    };
  }, []);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnectAll();
      observerRef.current = undefined;
    };
  }, [client]);

  useEffect(() => {
    if (networkSendingEnabled === undefined) {
      return;
    }
    client.configureCapture({ enableNetworkSending: networkSendingEnabled });
  }, [client, networkSendingEnabled]);

  useEffect(() => {
    syncConsent(client, "analytics", analyticsConsent);
    if (analyticsConsent === "denied") {
      observerRef.current?.disconnectAll();
      observerRef.current = undefined;
    }
  }, [client, analyticsConsent]);

  useEffect(() => {
    syncConsent(client, "measurement", measurementConsent);
    if (measurementConsent === "denied") {
      observerRef.current?.disconnectAll();
      observerRef.current = undefined;
    }
  }, [client, measurementConsent]);

  const value = useMemo((): TrackingContextValue => ({ client, visibility }), [client, visibility]);

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>;
};
