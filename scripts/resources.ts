// Single list of isolated resources per variant. Each variant has its own
// databases, Elasticsearch index prefixes, and ports, so all three can run
// at the same time without collisions.
export const VARIANTS = {
  express: { apiPort: 4100, webPort: 4101, workerPort: 4102, realtimePort: 4100, database: 'ofl_express', esPrefix: 'ofl_express_' },
  fastify: { apiPort: 4200, webPort: 4201, workerPort: 4202, realtimePort: 4200, database: 'ofl_fastify', esPrefix: 'ofl_fastify_' },
  nextjs: { apiPort: 4300, webPort: 4300, workerPort: 4302, realtimePort: 4301, database: 'ofl_nextjs', esPrefix: 'ofl_nextjs_' },
} as const;

/** Every database the lab uses: dev and test per variant, plus shared-package tests and benchmarks. */
export const ALL_DATABASES = [
  ...Object.values(VARIANTS).flatMap((v) => [v.database, `${v.database}_test`]),
  'ofl_core_test',
  'ofl_bench',
];
