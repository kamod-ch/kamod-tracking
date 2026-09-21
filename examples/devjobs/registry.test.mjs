import { createDevjobsRegistry } from "./registry.ts";

const registry = createDevjobsRegistry();
if (!registry.get("devjobs.listing.view", 1)) {
  throw new Error("missing devjobs.listing.view");
}
const validated = registry.validateProperties("devjobs.apply.click", 1, {
  path: "/jobs/123",
  listing_id: "job_123",
});
if (!validated.ok) {
  throw new Error("devjobs.apply.click validation failed");
}
console.log("devjobs registry example: ok");
