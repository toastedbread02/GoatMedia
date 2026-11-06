#!/usr/bin/env node
// Serves the built client and the API from one Express process.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';

const dist = path.resolve('dist', 'index.html');
if (!existsSync(dist)) {
  console.error('\nNo production build found. Run `npm run build` first.\n');
  process.exit(1);
}

const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});

const stop = () => child.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
