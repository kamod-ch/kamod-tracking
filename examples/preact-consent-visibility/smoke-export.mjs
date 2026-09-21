const preact = await import("@kamod-ch/tracking/preact");
if (typeof preact.TrackingProvider !== "function") {
  throw new Error("missing TrackingProvider export");
}
if (typeof preact.useVisibleImpression !== "function") {
  throw new Error("missing useVisibleImpression export");
}
console.log("preact-consent-visibility export smoke: ok (run vitest for full demo)");
