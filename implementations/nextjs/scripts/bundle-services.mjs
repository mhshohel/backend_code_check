// Bundles the two plain-Node entry points (realtime service, worker) with
// esbuild. Workspace packages (@ofl/*) are TypeScript source and are bundled;
// native or Node-heavy dependencies stay external and are resolved from
// node_modules at runtime (they are direct dependencies of this package).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const external = [
  'pg',
  'pg-native',
  '@node-rs/argon2',
  '@elastic/elasticsearch',
  'pino',
  'pino-pretty',
  'prom-client',
  'ws',
  'bufferutil',
  'utf-8-validate',
];

await build({
  absWorkingDir: root,
  entryPoints: { realtime: 'modules/realtime/main.ts', worker: 'worker/main.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  // Some bundled CommonJS dependencies call require(); give ESM output a real one.
  banner: { js: "import { createRequire as __oflCreateRequire } from 'node:module'; const require = __oflCreateRequire(import.meta.url);" },
  logLevel: 'info',
});
