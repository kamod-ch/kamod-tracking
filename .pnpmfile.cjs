// tsup 9 calls the TypeScript compiler API. TypeScript 7 does not ship it,
// and pnpm 11 cannot drop tsup's typescript peer via overrides, so the peer
// would resolve to TypeScript 7 and break declaration emit.
function readPackage(pkg) {
  if (pkg.name !== "tsup") return pkg;

  pkg.dependencies ??= {};
  pkg.dependencies.typescript = "npm:@typescript/typescript6@6.0.2";
  delete pkg.peerDependencies?.typescript;
  delete pkg.peerDependenciesMeta?.typescript;
  return pkg;
}

module.exports = {
  hooks: { readPackage },
};
