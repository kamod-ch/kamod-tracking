import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as core from "../src/index";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("package boundaries", () => {
  it("imports the core contract in Node without Preact or a browser tracker", () => {
    expect(typeof core.createTrackingPipeline).toBe("function");
    expect(typeof core.recordConsent).toBe("function");
    expect(core.DEFAULT_VISITOR_IDENTITY).toBe("off");
    expect("createBrowserTracker" in core).toBe(false);
    expect("TrackingProvider" in core).toBe(false);
    expect("createIngestHandler" in core).toBe(false);
    expect(typeof globalThis.document).toBe("undefined");
  });

  it("exports implemented subpaths only", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
      peerDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect("." in pkg.exports).toBe(true);
    expect("./browser" in pkg.exports).toBe(true);
    expect("./preact" in pkg.exports).toBe(true);
    expect("./server" in pkg.exports).toBe(true);
    expect(Object.keys(pkg.exports)).toHaveLength(5);
    expect("./postgres" in pkg.exports).toBe(true);
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies?.preact).toBe(">=10.0.0");
    expect(pkg.peerDependencies?.pg).toBe(">=8.11.0");
  });
});
