// Runs the variant's processes together.
//   node scripts/run.mjs dev    API + worker from TypeScript (watch) and the Vite dev server
//   node scripts/run.mjs start  API + worker from the esbuild bundles in dist/
// Ctrl+C forwards SIGINT to every child so each runs its graceful shutdown.
import { spawn } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';

const MODES = {
  dev: [
    { name: 'api', command: 'node', args: ['--import', 'tsx', '--watch', 'api/server.ts'] },
    { name: 'worker', command: 'node', args: ['--import', 'tsx', '--watch', 'worker/main.ts'] },
    { name: 'web', command: 'vite', args: ['--config', 'web/vite.config.ts'] },
  ],
  start: [
    { name: 'api', command: 'node', args: ['--enable-source-maps', 'dist/api/server.js'] },
    { name: 'worker', command: 'node', args: ['--enable-source-maps', 'dist/worker/main.js'] },
  ],
};

const mode = process.argv[2] ?? 'dev';
const processes = MODES[mode];
if (!processes) throw new Error(`Unknown mode ${mode}. Use dev or start.`);

const children = processes.map(({ name, command, args }) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = (chunk) => chunk.toString().replace(/^(?=.)/gm, `[${name}] `);
  child.stdout.on('data', (chunk) => process.stdout.write(prefix(chunk)));
  child.stderr.on('data', (chunk) => process.stderr.write(prefix(chunk)));
  child.on('exit', (code) => {
    console.warn(`[${name}] exited with ${code}`);
    stopAll();
  });
  return child;
});

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGINT');
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
