import { describe, expectTypeOf, it } from "vitest";
import type {
  ContentViewPropertiesV1,
  ContentViewPropertiesV2,
} from "../src/core/events/content-view";

describe("typed event properties", () => {
  it("requires registered property shapes for known events", () => {
    expectTypeOf<{ path: string; content_type: string }>().toMatchTypeOf<ContentViewPropertiesV1>();
    expectTypeOf<{
      path: string;
      content_type: string;
      section: string;
    }>().toMatchTypeOf<ContentViewPropertiesV2>();
    expectTypeOf<{ path: string; title: string }>().not.toMatchTypeOf<ContentViewPropertiesV1>();
  });
});
