import type { RefObject } from "preact";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import type { BrowserCaptureInput, BrowserClient, BrowserTrackerOptions } from "../browser/client";
import { createBrowserTracker } from "../browser/client";
import type { VisibilityImpressionCallback } from "../browser/visibility-observer";
import { TrackingContext } from "./context";

export const useTrackingContext = (): NonNullable<
  ReturnType<typeof useOptionalTrackingContext>
> => {
  const value = useOptionalTrackingContext();
  if (!value) {
    throw new Error("Tracking hooks must be used inside <TrackingProvider>.");
  }
  return value;
};

/** Undefined when the provider is not mounted (e.g. lazy client bootstrap). */
export const useOptionalTrackingContext = () => useContext(TrackingContext);

export const useTrackingClient = (): BrowserClient => useTrackingContext().client;

export const useCapture = (): ((input: BrowserCaptureInput) => void) => {
  const client = useTrackingClient();
  return useCallback(
    (input) => {
      void client.capture(input);
    },
    [client],
  );
};

/**
 * Creates a browser client once after mount. Returns `undefined` during SSR and the first render.
 * When `destroyOnUnmount` is true, the hook owns the instance and calls `destroy()` on cleanup.
 */
export const useBrowserTrackingClient = (
  options: BrowserTrackerOptions,
  config?: { readonly destroyOnUnmount?: boolean },
): BrowserClient | undefined => {
  const clientRef = useRef<BrowserClient | undefined>(undefined);
  const [, bump] = useState(0);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!clientRef.current) {
      clientRef.current = createBrowserTracker(optionsRef.current);
      bump((n) => n + 1);
    }
    return () => {
      if (config?.destroyOnUnmount === true && clientRef.current) {
        clientRef.current.destroy();
        clientRef.current = undefined;
      }
    };
  }, [config?.destroyOnUnmount]);

  return clientRef.current;
};

/**
 * Opens a view surface on mount and closes it on unmount. Use on route shells or modals.
 */
export const useViewSurface = (surface: string, enabled = true): void => {
  const client = useTrackingClient();
  useEffect(() => {
    if (!enabled) {
      return;
    }
    client.beginView({ surface });
    return () => {
      client.endView();
    };
  }, [client, surface, enabled]);
};

/**
 * Records a page view after mount. Does not read location at import or during SSR render.
 */
export const usePageView = (path: string, enabled = true): void => {
  const client = useTrackingClient();
  useEffect(() => {
    if (!enabled) {
      return;
    }
    void client.pageView({ path });
  }, [client, path, enabled]);
};

export type UseVisibleImpressionOptions = {
  readonly subjectKey: string;
  readonly eligible?: () => boolean;
  readonly onImpression?: VisibilityImpressionCallback;
  readonly enabled?: boolean;
};

/**
 * Wires an element ref to the shared visibility observer. Impressions fire only after mount in the browser.
 */
export const useVisibleImpression = (
  targetRef: RefObject<Element | null>,
  options: UseVisibleImpressionOptions,
): void => {
  const { visibility } = useTrackingContext();
  const onImpressionRef = useRef(options.onImpression);
  const eligibleRef = useRef(options.eligible);
  onImpressionRef.current = options.onImpression;
  eligibleRef.current = options.eligible;

  useLayoutEffect(() => {
    if (options.enabled === false) {
      return;
    }
    const element = targetRef.current;
    if (!element) {
      return;
    }
    const handle = visibility.observe(element, {
      subjectKey: options.subjectKey,
      ...(eligibleRef.current !== undefined
        ? { eligible: () => eligibleRef.current?.() ?? true }
        : {}),
      ...(onImpressionRef.current !== undefined
        ? {
            onImpression: (payload) => {
              onImpressionRef.current?.(payload);
            },
          }
        : {}),
    });
    return () => {
      handle.disconnect();
    };
  }, [visibility, targetRef, options.enabled, options.subjectKey]);
};

/** @deprecated Use `useTrackingClient`. */
export const useTracker = (): BrowserClient => useTrackingClient();
