/* GoatMedia service worker.
 *
 * The cache name carries the build, so a deploy starts a new cache and the old
 * one is dropped on activate. Navigations go to the network first, which is what
 * keeps a fresh deploy from being hidden behind a stale shell; assets are hashed
 * by Vite, so serving those from cache is safe.
 *
 * It also receives the share sheet: Android sends a POST here, the file is put
 * in a small cache, and the browser is redirected to the upload page.
 */

const VERSION = '__BUILD__';
const ROOT = new URL('./', self.location.href);
const BASE = ROOT.pathname;
const CACHE = `goatmedia-${VERSION}`;
const SHARE_CACHE = 'goatmedia-share';
const SHELL = [
  BASE,
  `${BASE}manifest.webmanifest`,
  `${BASE}mark.svg`,
  `${BASE}icons/icon-192.png`,
  `${BASE}icons/icon-512.png`,
  `${BASE}fonts/instrument-sans-latin.woff2`,
  `${BASE}fonts/bricolage-latin.woff2`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (response.ok) await cache.put(url, response);
          } catch {
            /* one missing file must not stop the worker from installing */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('goatmedia-') && key !== CACHE && key !== SHARE_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

async function takeShare(request) {
  try {
    const form = await request.formData();
    const file = form.get('media');
    const cache = await caches.open(SHARE_CACHE);
    if (file && typeof file === 'object' && 'arrayBuffer' in file) {
      const name = file.name || 'shared.mp4';
      await cache.put(
        new Request(new URL('__shared-file', ROOT).href),
        new Response(file, {
          headers: {
            'content-type': file.type || 'video/mp4',
            'x-file-name': encodeURIComponent(name),
          },
        }),
      );
    }
    const title = String(form.get('title') || '');
    const text = String(form.get('text') || '');
    if (title || text) {
      await cache.put(
        new Request(new URL('__shared-text', ROOT).href),
        new Response(JSON.stringify({ title, text }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
  } catch {
    /* the upload page still opens, with nothing attached */
  }
  return Response.redirect(new URL('upload?shared=1', ROOT).href, 303);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === `${BASE}share-target`) {
    event.respondWith(takeShare(request));
    return;
  }
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(BASE, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          const cached = (await cache.match(request)) || (await cache.match(BASE));
          return (
            cached ||
            new Response('GoatMedia is offline and this page was not saved.', {
              status: 503,
              headers: { 'content-type': 'text/plain; charset=utf-8' },
            })
          );
        }
      })(),
    );
    return;
  }

  if (/\/assets\/|\/icons\/|\/fonts\/|\.(?:css|js|woff2|png|svg|jpe?g|webp)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const fresh = await fetch(request);
        if (fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      })(),
    );
  }
});
