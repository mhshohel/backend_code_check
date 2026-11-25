/* global process, console, setTimeout, setInterval, clearInterval */
// Starts the three processes of the Next.js variant and stops them together:
//   app (next, port 9008) · realtime graphql-ws service (9009) · worker (health 9010)
// Usage: node scripts/run-services.mjs dev|start
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'start') {
  console.error('usage: run-services.mjs dev|start');
  process.exit(2);
}

const bin = (name) => {
  const local = resolve(root, 'node_modules/.bin', name);
  return existsSync(local) ? local : resolve(root, '../../node_modules/.bin', name);
};
const appPort = process.env.PORT ?? '9008';
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };

const commands =
  mode === 'dev'
    ? [
        { name: 'app', cmd: bin('next'), args: ['dev', '-p', appPort] },
        { name: 'realtime', cmd: bin('tsx'), args: ['watch', 'modules/realtime/main.ts'] },
        { name: 'worker', cmd: bin('tsx'), args: ['watch', 'worker/main.ts'] },
      ]
    : [
        { name: 'app', cmd: bin('next'), args: ['start', '-p', appPort] },
        { name: 'realtime', cmd: process.execPath, args: ['dist/realtime.mjs'], env: { NODE_ENV: 'production' } },
        { name: 'worker', cmd: process.execPath, args: ['dist/worker.mjs'], env: { NODE_ENV: 'production' } },
      ];

if (mode === 'start') {
  for (const file of ['dist/realtime.mjs', 'dist/worker.mjs', '.next/BUILD_ID']) {
    if (!existsSync(resolve(root, file))) {
      console.error(`missing ${file}; run "pnpm build" first`);
      process.exit(1);
    }
  }
}

const children = new Map();
let shuttingDown = false;

function stopAll(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) child.kill('SIGTERM');
  const force = setTimeout(() => {
    for (const child of children.values()) child.kill('SIGKILL');
    process.exit(exitCode);
  }, 20_000);
  force.unref();
  const waitForAll = setInterval(() => {
    if ([...children.values()].every((child) => child.exitCode !== null || child.signalCode !== null)) {
      clearInterval(waitForAll);
      process.exit(exitCode);
    }
  }, 100);
}

for (const { name, cmd, args, env: extra } of commands) {
  const child = spawn(cmd, args, { cwd: root, env: { ...env, ...extra }, stdio: 'inherit' });
  children.set(name, child);
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[${name}] exited (${signal ?? code}); stopping the other processes`);
      stopAll(code ?? 1);
    }
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
