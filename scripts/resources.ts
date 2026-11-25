// Single list of isolated resources per variant. Each variant has its own
// databases, Elasticsearch index prefixes, and ports, so all three can run
// at the same time without collisions.
export const VARIANTS = {
  express: { apiPort: 9001, webPort: 9002, workerPort: 9004, realtimePort: 9001, database: 'ofl_express', esPrefix: 'ofl_express_' },
  fastify: { apiPort: 9005, webPort: 9006, workerPort: 9007, realtimePort: 9005, database: 'ofl_fastify', esPrefix: 'ofl_fastify_' },
  nextjs: { apiPort: 9008, webPort: 9008, workerPort: 9010, realtimePort: 9009, database: 'ofl_nextjs', esPrefix: 'ofl_nextjs_' },
} as const;

/** Every database the lab uses: dev and test per variant, plus shared-package tests and benchmarks. */
export const ALL_DATABASES = [
  ...Object.values(VARIANTS).flatMap((v) => [v.database, `${v.database}_test`]),
  'ofl_core_test',
  'ofl_bench',
];
