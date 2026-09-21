import type { CaptureIdentityMode } from "../core/capture-policy";
import type { CollectorContext } from "../core/envelope";

/**
 * Public ingest key (URL segment). Identifies a site; not a secret.
 */
export type PublicIngestSite = {
  readonly publicKey: string;
  readonly tenantId: string;
  readonly siteId: string;
  readonly appId: string;
  readonly collector: CollectorContext;
  /** Allowed Origin / Referer host values (scheme + host, no path). */
  readonly allowedOrigins: readonly string[];
  readonly browserIdentityMode: CaptureIdentityMode;
};

export type SiteRegistry = {
  resolveByPublicKey(publicKey: string): PublicIngestSite | undefined;
  resolveByAppId(appId: string): PublicIngestSite | undefined;
};

export const createStaticSiteRegistry = (sites: readonly PublicIngestSite[]): SiteRegistry => {
  const byKey = new Map(sites.map((site) => [site.publicKey, site]));
  const byApp = new Map(sites.map((site) => [site.appId, site]));
  return {
    resolveByPublicKey(publicKey) {
      return byKey.get(publicKey);
    },
    resolveByAppId(appId) {
      return byApp.get(appId);
    },
  };
};
