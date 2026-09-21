import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packageRoot = join(repoRoot, "packages/core");
const packDir = join(tmpdir(), "kamod-tracking-pack");
const consumerRoot = mkdtempSync(join(tmpdir(), "kamod-tracking-export-consumer-"));

const run = (command, options = {}) => {
  execSync(command, { stdio: "inherit", ...options });
};

run("pnpm build", { cwd: repoRoot });

rmSync(packDir, { recursive: true, force: true });
mkdirSync(packDir, { recursive: true });
run(`pnpm pack --pack-destination ${packDir}`, { cwd: packageRoot });

const tarball = execSync(`ls ${packDir}/kamod-ch-tracking-*.tgz`, { encoding: "utf8" })
  .trim()
  .split("\n")[0];
if (!tarball) {
  throw new Error("packed tarball not found");
}

const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
if (!pkg.exports["./postgres"]) {
  throw new Error("missing ./postgres export");
}

const browserJs = readFileSync(join(packageRoot, "dist/browser.js"), "utf8");
if (
  browserJs.includes("node:") ||
  browserJs.includes('from "pg"') ||
  browserJs.includes("createIngestHandler")
) {
  throw new Error("browser build contains Node-only or collector code");
}

writeFileSync(
  join(consumerRoot, "package.json"),
  JSON.stringify(
    {
      name: "kamod-tracking-export-consumer",
      private: true,
      type: "module",
      dependencies: {
        "@kamod-ch/tracking": `file:${tarball}`,
      },
    },
    null,
    2,
  ),
);

run("pnpm install", { cwd: consumerRoot });

writeFileSync(
  join(consumerRoot, "consumer.mjs"),
  `const core = await import("@kamod-ch/tracking");
if (typeof core.createTrackingPipeline !== "function") throw new Error("missing core pipeline");
if (typeof core.recordConsent !== "function") throw new Error("missing consent");
if ("createBrowserTracker" in core) throw new Error("core must not export the browser client");
if ("TrackingProvider" in core) throw new Error("core must not export Preact");
if ("createIngestHandler" in core) throw new Error("core must not export the collector");

const browser = await import("@kamod-ch/tracking/browser");
if (typeof browser.createBrowserTracker !== "function") throw new Error("missing browser tracker");

const server = await import("@kamod-ch/tracking/server");
if (typeof server.createIngestHandler !== "function") throw new Error("missing server collector");

const postgres = await import("@kamod-ch/tracking/postgres");
if (typeof postgres.createScopedPostgresEnvelopeStore !== "function") {
  throw new Error("missing postgres scoped store");
}
if (typeof postgres.applyTrackingMigrations !== "function") {
  throw new Error("missing postgres migrations");
}

console.log("packed export consumer: ok");
`,
);

run("node consumer.mjs", { cwd: consumerRoot });
rmSync(consumerRoot, { recursive: true, force: true });
rmSync(packDir, { recursive: true, force: true });
