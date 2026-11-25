import { closeServices, createServices, loadConfig } from '@ofl/server-core';
import { startRealtimeServer, type RunningRealtimeServer } from '@/modules/realtime/server';
import { freePort } from './next-process';

/** Runs the realtime service in the test process with its own Services (own LISTEN connection). */
export async function startRealtime(env: Record<string, string>, appOrigin: string): Promise<RunningRealtimeServer> {
  const services = await createServices(loadConfig(env), { role: 'api' });
  const server = await startRealtimeServer({ services, port: await freePort(), host: '127.0.0.1', allowedOrigins: [appOrigin] });
  return {
    ...server,
    async close() {
      await server.close();
      await closeServices(services);
    },
  };
}
