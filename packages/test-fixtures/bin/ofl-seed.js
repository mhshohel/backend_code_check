#!/usr/bin/env node
// `ofl-seed` loads a fixture profile into the database of the current
// directory's .env (each variant has its own), through tsx (no build step).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const envFile = path.join(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

register();
const { runSeedCli } = await import('../src/cli.ts');
process.exitCode = await runSeedCli(process.argv.slice(2));
