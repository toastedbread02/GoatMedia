import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { attachUser } from './auth.ts';
import { APP_ORIGIN, AVATAR_DIR, DIST_DIR, IS_PRODUCTION, PORT, allowedOrigins, ensureDataDirs } from './config.ts';
import { HttpError } from './util.ts';
import { authRouter } from './routes/auth.ts';
import { videosRouter, mediaRouter } from './routes/videos.ts';
import { usersRouter } from './routes/users.ts';
import { socialRouter } from './routes/social.ts';
import { adminRouter } from './routes/admin.ts';
import { mediaToolsAvailable } from './media.ts';

ensureDataDirs();

const app = express();
app.disable('x-powered-by');
// Behind Caddy/nginx the real client IP and protocol arrive in headers.
if (IS_PRODUCTION) app.set('trust proxy', 1);

// Credentialed CORS for a site served from a different origin (GitHub Pages).
// Same-origin deployments never send an Origin header for GETs and are unaffected.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(origin && allowedOrigins.has(origin) ? 204 : 403).end();
    return;
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(attachUser);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const allowed = new Set([...allowedOrigins, APP_ORIGIN, `${req.protocol}://${req.get('host')}`]);
  if (!allowed.has(origin)) {
    return res.status(403).json({ error: 'Cross-site request blocked.' });
  }
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mediaTools: mediaToolsAvailable(), time: Date.now() });
});

app.use('/api', authRouter);
app.use('/api', videosRouter);
app.use('/api', usersRouter);
app.use('/api', socialRouter);
app.use('/api', adminRouter);
app.use('/media', mediaRouter);

app.use(
  '/avatars',
  express.static(AVATAR_DIR, { maxAge: '7d', immutable: true, fallthrough: false, index: false }),
);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'That endpoint does not exist.' });
});

if (fs.existsSync(DIST_DIR)) {
  app.use(
    express.static(DIST_DIR, {
      index: false,
      setHeaders: (res, filePath) => {
        if (/\.(woff2|png|svg|jpg|webp)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=604800');
        }
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'), (error) => {
      if (error) next();
    });
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code, fields: err.fields });
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'That file is too large for the current limit.' });
    }
    return res.status(400).json({ error: 'That upload did not go through. Try again.' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'That request could not be read.' });
  }
  console.error('[GoatMedia] Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on our end. Try again in a moment.' });
});

const server = app.listen(PORT, () => {
  const url = IS_PRODUCTION ? `http://localhost:${PORT}` : `http://localhost:5173`;
  console.log(`\n  GoatMedia API listening on http://localhost:${PORT}`);
  console.log(`  Open the app at ${url}`);
  console.log(`  Video tools (ffmpeg/ffprobe): ${mediaToolsAvailable() ? 'available' : 'missing — uploads need client duration and no metadata stripping'}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
