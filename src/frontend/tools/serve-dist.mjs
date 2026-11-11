// Serves the PRODUCTION build (dist/frontend/browser) on http://localhost:4300, to try the PWA.
//
// Why this exists: `ng serve` has no service worker, so installing and offline use can only be tried on a built app.
// Used by `npm run preview`. A development tool only: no dependencies, no compression, no TLS.
//
// What it does that matters for a service worker:
//  - a path that is not a file (/notes/123) gets index.html (the app is a single page: the router shows the page);
//  - it NEVER redirects (a redirected /index.html makes the service worker refuse to install);
//  - index.html and the service worker's own files are sent with "no-cache", so a new build is noticed at once.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist/frontend/browser');
const port = Number(process.argv[3] ?? 4300);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

async function fileFor(urlPath) {
  const candidate = normalize(join(root, decodeURIComponent(urlPath)));
  // Never leave the build folder (../ in the URL).
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return null;
  }
  try {
    return (await stat(candidate)).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  let file = await fileFor(pathname);
  if (!file && !extname(pathname)) {
    file = join(root, 'index.html'); // a route of the single-page app
  }
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  const name = file.slice(root.length + 1);
  const mustRevalidate = name === 'index.html' || name === 'ngsw.json' || name.startsWith('ngsw-worker') || name === 'manifest.webmanifest';
  response.writeHead(200, {
    'content-type': types[extname(file)] ?? 'application/octet-stream',
    // Hashed files never change under the same name; the few that do must be asked for every time.
    'cache-control': mustRevalidate ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  response.end(await readFile(file));
}).listen(port, () => console.log(`Serving ${root}\n  -> http://localhost:${port}   (Ctrl+C to stop)`));
