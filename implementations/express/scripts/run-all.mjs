/* global process, console, setTimeout */
// Runs several processes with prefixed output; no extra dependency needed.
//   node scripts/run-all.mjs dev    API (tsx watch) + worker (tsx watch) + Vite
//   node scripts/run-all.mjs start  built API + built worker (run `pnpm build` first)
// One Ctrl+C (or SIGTERM) stops all of them; if one exits, the others are stopped.
import { spawn } from 'node:child_process';

const node = process.execPath;
const MODES = {
  dev: [
    { name: 'api', command: 'tsx', args: ['watch', '--clear-screen=false', 'api/server.ts'] },
    { name: 'worker', command: 'tsx', args: ['watch', '--clear-screen=false', 'worker/main.ts'] },
    { name: 'web', command: 'vite', args: ['--config', 'web/vite.config.ts'] },
  ],
  start: [
    { name: 'api', command: node, args: ['--enable-source-maps', 'dist/server.js'] },
    { name: 'worker', command: node, args: ['--enable-source-maps', 'dist/worker.js'] },
  ],
};

const processes = MODES[process.argv[2]];
if (!processes) {
  console.error(`Usage: node scripts/run-all.mjs <${Object.keys(MODES).join('|')}>`);
  process.exit(2);
}

const children = processes.map(({ name, command, args }) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = (stream, target) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) if (line) target.write(`[${name}] ${line}\n`);
    });
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stderr.write(`[${name}] exited with ${code}\n`);
    stopAll(code ?? 1);
  });
  return child;
});

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 3000).unref();
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
