import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const distDir = join(repoRoot, "packages/core/dist");
const files = ["index.js", "browser.js", "preact.js", "server.js", "postgres.js"];

const rows = files.map((file) => {
  const path = join(distDir, file);
  const raw = readFileSync(path);
  const gzip = gzipSync(raw);
  return {
    file,
    bytesRaw: raw.length,
    bytesGzip: gzip.length,
  };
});

console.log(
  JSON.stringify(
    { measuredAt: new Date().toISOString(), dist: "packages/core/dist", rows },
    null,
    2,
  ),
);
