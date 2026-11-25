import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Jest cannot render async Server Components, so page tests run against the
// real production server: `next start` in a child process on a free port.
// The build (.next) must exist; `pnpm test` runs `next build` first.

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export type RunningNext = { baseUrl: string; port: number; stop(): Promise<void> };

export async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function nextBinary(): string {
  const local = resolve(appRoot, 'node_modules/.bin/next');
  if (!existsSync(local)) throw new Error('next binary not found; run pnpm install');
  return local;
}

async function waitUntilLive(baseUrl: string, child: ChildProcess, output: () => string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited early (${child.exitCode}):\n${output()}`);
    try {
      const response = await fetch(`${baseUrl}/api/health/live`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`next start did not become live within ${timeoutMs} ms:\n${output()}`);
}

export async function startNext(env: Record<string, string>, extra: { realtimePort?: number } = {}): Promise<RunningNext> {
  if (!existsSync(resolve(appRoot, '.next/BUILD_ID'))) {
    throw new Error('No production build found. Run `pnpm build` (or `pnpm test`, which builds first).');
  }
  const port = await freePort();
  let output = '';
  const child = spawn(nextBinary(), ['start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      ...(extra.realtimePort ? { REALTIME_PORT: String(extra.realtimePort) } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitUntilLive(baseUrl, child, () => output);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
  return {
    baseUrl,
    port,
    stop: () =>
      new Promise<void>((resolveStop) => {
        if (child.exitCode !== null) return resolveStop();
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolveStop();
        });
        child.kill('SIGTERM');
      }),
  };
}
