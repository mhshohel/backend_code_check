// Bundles the API and worker with esbuild. Workspace packages (@ofl/*) are
// TypeScript sources, so they are bundled; everything from node_modules stays
// external and is resolved at runtime from this package's node_modules.
import { build } from 'esbuild';

/** @type {import('esbuild').Plugin} */
const externalNodeModules = {
  name: 'external-node-modules',
  setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@ofl/')) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: { server: 'api/main.ts', worker: 'worker/main.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  plugins: [externalNodeModules],
  logLevel: 'info',
});
