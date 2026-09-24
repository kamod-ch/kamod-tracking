/** @vitest-environment jsdom */

import { useLayoutEffect, useRef } from "preact/hooks";
import { render, waitFor } from "@testing-library/preact";
import { render as renderToString } from "preact-render-to-string";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoApp } from "../src/examples/preact-job-demo";
import { createDevjobsRegistry } from "./fixtures/devjobs-registry";
import * as browserClient from "../src/browser/client";
import {
  createBrowserTracker,
  createMemoryKeyValueStorage,
  createMemoryTransport,
} from "../src/browser";
import type {
  IntersectionObserverEntryLike,
  IntersectionObserverLike,
} from "../src/browser/visibility-observer";
import {
  TrackingProvider,
  useBrowserTrackingClient,
  usePageView,
  useTrackingContext,
  useVisibleImpression,
} from "../src/preact";

const Page = ({ path }: { path: string }) => {
  usePageView(path);
  return <p>ok</p>;
};

const makeTracker = (options?: { readonly withRegistry?: boolean }) => {
  const transport = createMemoryTransport();
  const tracker = createBrowserTracker({
    appId: "demo-app",
    storage: createMemoryKeyValueStorage(),
    transport,
    now: () => new Date("2026-09-21T12:00:00.000Z"),
    ids: { eventId: () => "evt_preact", visitorId: () => "vis_preact" },
    ...(options?.withRegistry === true ? { registry: createDevjobsRegistry() } : {}),
  });
  tracker.setConsent("analytics", "granted");
  tracker.setConsent("measurement", "granted");
  tracker.configureCapture({ enableNetworkSending: true });
  return { tracker, transport };
};

describe("preact adapter", () => {
  it("does not record page views during SSR render", () => {
    const { tracker, transport } = makeTracker();
    const html = renderToString(
      <TrackingProvider client={tracker}>
        <Page path="/pricing" />
      </TrackingProvider>,
    );
    expect(html).toContain("ok");
    expect(transport.sent).toEqual([]);
  });

  it("records a page view after mount", async () => {
    const { tracker, transport } = makeTracker();
    render(
      <TrackingProvider client={tracker}>
        <Page path="/pricing?utm=1" />
      </TrackingProvider>,
    );
    await waitFor(() => {
      expect(transport.sent).toHaveLength(1);
    });
    expect(transport.sent[0]?.name).toBe("page_view");
    expect(transport.sent[0]?.properties.path).toBe("/pricing");
  });

  it("does not recreate the client when provider props change", async () => {
    const { tracker, transport } = makeTracker();
    const createSpy = vi.spyOn(browserClient, "createBrowserTracker");
    const { rerender } = render(
      <TrackingProvider client={tracker} networkSendingEnabled={false}>
        <Page path="/a" />
      </TrackingProvider>,
    );
    rerender(
      <TrackingProvider client={tracker} networkSendingEnabled={true}>
        <Page path="/a" />
      </TrackingProvider>,
    );
    await waitFor(() => expect(transport.sent.length).toBeGreaterThan(0));
    expect(createSpy).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it("hydrates without duplicating SSR markup", async () => {
    const { tracker, transport } = makeTracker();
    const html = renderToString(
      <TrackingProvider client={tracker}>
        <Page path="/hydrate" />
      </TrackingProvider>,
    );
    expect(html).toBe("<p>ok</p>");
    expect(transport.sent).toEqual([]);
    render(
      <TrackingProvider client={tracker}>
        <Page path="/hydrate" />
      </TrackingProvider>,
    );
    await waitFor(() => expect(transport.sent).toHaveLength(1));
  });
});

describe("preact visibility", () => {
  let ioCallback: ((entries: readonly IntersectionObserverEntryLike[]) => void) | undefined;
  let observeCount = 0;
  let observerInstances = 0;

  beforeEach(() => {
    observeCount = 0;
    observerInstances = 0;
    ioCallback = undefined;
    vi.useFakeTimers();
    class MockIntersectionObserver implements IntersectionObserverLike {
      constructor(callback: (entries: readonly IntersectionObserverEntryLike[]) => void) {
        observerInstances += 1;
        ioCallback = callback;
      }
      observe() {
        observeCount += 1;
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const VisibleCard = ({ subjectKey }: { subjectKey: string }) => {
    const ref = useRef<HTMLDivElement>(null);
    useVisibleImpression(ref, {
      subjectKey,
      onImpression: () => {},
    });
    return <div ref={ref} data-card={subjectKey} />;
  };

  it("creates one shared observer for multiple cards", async () => {
    const { tracker } = makeTracker();
    render(
      <TrackingProvider client={tracker}>
        <VisibleCard subjectKey="job_a" />
        <VisibleCard subjectKey="job_b" />
      </TrackingProvider>,
    );
    await Promise.resolve();
    expect(observeCount).toBe(2);
    expect(observerInstances).toBe(1);
  });

  it("does not count the same subject when remounted in the same view", async () => {
    const { tracker } = makeTracker();
    tracker.beginView({ surface: "job-list" });
    let impressions = 0;
    let mountedEl: Element | null = null;
    const Card = ({ show }: { show: boolean }) => {
      const ref = useRef<HTMLDivElement>(null);
      const { visibility } = useTrackingContext();
      useLayoutEffect(() => {
        mountedEl = ref.current;
      });
      useVisibleImpression(ref, {
        subjectKey: "listing_demo_zrh_01",
        onImpression: () => {
          impressions += 1;
          visibility.confirmImpression("listing_demo_zrh_01");
        },
      });
      return show ? <div ref={ref} /> : null;
    };
    const { rerender } = render(
      <TrackingProvider client={tracker}>
        <Card show={true} />
      </TrackingProvider>,
    );
    await waitFor(() => {
      expect(mountedEl).toBeTruthy();
      expect(typeof ioCallback).toBe("function");
    });
    const firstEl = mountedEl!;
    ioCallback!([{ target: firstEl, intersectionRatio: 0.5 }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(impressions).toBe(1);

    rerender(
      <TrackingProvider client={tracker}>
        <Card show={false} />
      </TrackingProvider>,
    );
    rerender(
      <TrackingProvider client={tracker}>
        <Card show={true} />
      </TrackingProvider>,
    );
    await waitFor(() => expect(mountedEl).toBeTruthy());
    const secondEl = mountedEl!;
    ioCallback!([{ target: secondEl, intersectionRatio: 0.5 }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(impressions).toBe(1);
  });
});

describe("preact demo app", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops capture after consent revoke via provider props", async () => {
    const { tracker, transport } = makeTracker({ withRegistry: true });
    const { rerender } = render(
      <DemoApp client={tracker} networkSendingEnabled analyticsConsent="granted" />,
    );
    rerender(
      <DemoApp
        client={tracker}
        networkSendingEnabled
        analyticsConsent="granted"
        measurementConsent="denied"
      />,
    );
    const before = transport.sent.length;
    const denied = await tracker.capture({
      event_name: "devjobs.listing.view",
      schema_version: 1,
      properties: { path: "/x", listing_id: "listing_demo_ber_02", canton: "BE" },
    });
    expect(denied.ok).toBe(false);
    expect(transport.sent.length).toBe(before);
  });
});

describe("useBrowserTrackingClient", () => {
  it("returns a client after mount without recreating on re-render", async () => {
    let instances = 0;
    const original = browserClient.createBrowserTracker;
    vi.spyOn(browserClient, "createBrowserTracker").mockImplementation((opts) => {
      instances += 1;
      return original(opts);
    });
    const Probe = ({ label }: { label: string }) => {
      const client = useBrowserTrackingClient({
        appId: "probe",
        transport: createMemoryTransport(),
      });
      return <span data-ready={client ? "yes" : "no"} data-label={label} />;
    };
    const { rerender } = render(<Probe label="a" />);
    await waitFor(() => expect(document.querySelector("[data-ready='yes']")).toBeTruthy());
    rerender(<Probe label="b" />);
    expect(instances).toBe(1);
    vi.restoreAllMocks();
  });
});
