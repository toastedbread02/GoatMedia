#!/usr/bin/env node
// Runs the API and the Vite dev server together, with one Ctrl-C to stop both.
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const children = [];
let shuttingDown = false;

function start(label, args) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(`\n[dev] ${label} stopped${code ? ` with exit code ${code}` : ''}.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 250);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('\n  GoatMedia dev\n  API  http://localhost:3001\n  App  http://localhost:5173\n');

if (!process.env.PORT) process.env.PORT = '3001';
start('API', ['--watch', '--import', 'tsx', 'server/index.ts']);
start('Vite', [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1']);

