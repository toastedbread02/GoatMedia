#!/usr/bin/env node
/**
 * Serves the built app through a free Cloudflare quick tunnel.
 *
 *   npm run public
 *
 * No account is needed, but the URL only lives while this process does, and it
 * changes every time you start it. Fine for showing the site to people today;
 * use a real host (see DEPLOY.md) for anything permanent.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PORT = process.env.PORT || '3010';
const dist = path.resolve('dist', 'index.html');

if (!existsSync(dist)) {
  console.error('\nNo production build found. Run `npm run build` first.\n');
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(tunnel);

tunnel.on('error', (error) => {
  console.error('\nCould not start cloudflared. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n', error.message, '\n');
  stop(1);
});

let started = false;
let buffer = '';

tunnel.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  process.stderr.write(text);
  if (started) return;
  buffer += text;
  const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!match) return;
  started = true;

  const origin = match[0];
  console.log(`\n  Public URL: ${origin}\n  Starting the app on port ${PORT}…\n`);

  const app = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', PORT, APP_ORIGIN: origin },
  });
  children.push(app);
  app.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`\n[public] app stopped${code ? ` with exit code ${code}` : ''}.`);
      stop(code ?? 1);
    }
  });
});

tunnel.on('exit', (code) => {
  if (!shuttingDown) {
    console.log(`\n[public] tunnel closed${code ? ` with exit code ${code}` : ''}.`);
    stop(code ?? 1);
  }
});
