#!/usr/bin/env node
// `ofl` operations CLI. Loads ./.env of the current directory (each variant
// has its own database and index prefix) and runs the TypeScript source
// through tsx, so there is no build step.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const envFile = path.join(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

register();
const { runCli } = await import('../src/cli.ts');
process.exitCode = await runCli(process.argv.slice(2));
