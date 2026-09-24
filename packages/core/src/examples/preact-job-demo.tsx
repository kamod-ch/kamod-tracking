import { useRef, useState } from "preact/hooks";
import type { BrowserClient } from "../browser/client";
import {
  TrackingProvider,
  useTrackingClient,
  useTrackingContext,
  useViewSurface,
  useVisibleImpression,
} from "../preact";

export type DemoListing = {
  readonly listing_id: string;
  readonly title: string;
  readonly canton: string;
  readonly is_job: boolean;
};

export const DEMO_LISTINGS: readonly DemoListing[] = [
  { listing_id: "listing_demo_zrh_01", title: "Platform Engineer", canton: "ZH", is_job: true },
  {
    listing_id: "listing_demo_ber_02",
    title: "SRE (6-month contract)",
    canton: "BE",
    is_job: true,
  },
  { listing_id: "promo_newsletter", title: "Subscribe to job alerts", canton: "ZH", is_job: false },
];

type JobCardProps = {
  readonly listing: DemoListing;
  readonly path: string;
  readonly onOpen: (listing: DemoListing) => void;
};

export const JobCard = ({ listing, path, onOpen }: JobCardProps) => {
  const client = useTrackingClient();
  const { visibility } = useTrackingContext();
  const cardRef = useRef<HTMLDivElement>(null);
  useVisibleImpression(cardRef, {
    subjectKey: listing.listing_id,
    eligible: () => listing.is_job,
    onImpression: () => {
      void client
        .capture({
          event_name: "devjobs.listing.view",
          schema_version: 1,
          properties: {
            path,
            listing_id: listing.listing_id,
            canton: listing.canton,
          },
        })
        .then((result) => {
          if (result.ok) {
            visibility.confirmImpression(listing.listing_id);
          } else {
            visibility.cancelImpression(listing.listing_id);
          }
        });
    },
  });

  return (
    <div ref={cardRef} data-listing={listing.listing_id}>
      <strong>{listing.title}</strong>
      <button type="button" onClick={() => onOpen(listing)}>
        Open detail
      </button>
    </div>
  );
};

const DemoRoutes = () => {
  const [detail, setDetail] = useState<DemoListing | undefined>(undefined);
  useViewSurface(detail ? "job-detail-modal" : "job-list");

  return (
    <main>
      <h1>Demo jobs</h1>
      <ul>
        {DEMO_LISTINGS.map((listing) => (
          <li key={listing.listing_id}>
            <JobCard listing={listing} path="/demo/jobs" onOpen={setDetail} />
          </li>
        ))}
      </ul>
      {detail ? (
        <section data-testid="job-detail">
          <h2>{detail.title}</h2>
          <button type="button" onClick={() => setDetail(undefined)}>
            Close
          </button>
        </section>
      ) : null}
    </main>
  );
};

export type DemoAppProps = {
  readonly client: BrowserClient;
  readonly networkSendingEnabled: boolean;
  readonly analyticsConsent: "granted" | "denied";
  readonly measurementConsent?: "granted" | "denied";
};

export const DemoApp = ({
  client,
  networkSendingEnabled,
  analyticsConsent,
  measurementConsent = "granted",
}: DemoAppProps) => (
  <TrackingProvider
    client={client}
    networkSendingEnabled={networkSendingEnabled}
    analyticsConsent={analyticsConsent}
    measurementConsent={measurementConsent}
  >
    <DemoRoutes />
  </TrackingProvider>
);
