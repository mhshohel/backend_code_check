// Bundles the API and the worker into dist/. Workspace packages (@ofl/*) are
// TypeScript sources, so they are bundled; everything from node_modules stays
// external and is resolved at runtime from this package's dependencies.
import { build } from 'esbuild';

/** @type {import('esbuild').Plugin} */
const externalizeNodeModules = {
  name: 'externalize-node-modules',
  setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@ofl/')) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: { 'api/server': 'api/server.ts', 'worker/main': 'worker/main.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  plugins: [externalizeNodeModules],
  logLevel: 'info',
});
