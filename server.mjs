// Production static server for the built game (dist/). No dependencies: the build is a
// single self-contained index.html plus whatever else lands in dist/, so a tiny Node
// server is all a host like Railway needs. Files are read and compressed once at startup.
//   npm run build && npm start   →   http://localhost:8080 (or $PORT)
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const ROOT = join(import.meta.dirname, 'dist');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg']);

/** url path → { type, raw, br, gz } */
const files = new Map();
function load(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { load(full); continue; }
    const ext = extname(name).toLowerCase();
    const raw = readFileSync(full);
    const zip = COMPRESSIBLE.has(ext) && raw.length > 1024;
    files.set('/' + relative(ROOT, full).split(sep).join('/'), {
      type: TYPES[ext] ?? 'application/octet-stream',
      raw,
      br: zip ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }) : null,
      gz: zip ? gzipSync(raw, { level: 9 }) : null,
      html: ext === '.html',
    });
  }
}
try { load(ROOT); } catch { /* reported below */ }
if (!files.has('/index.html')) {
  console.error(`No build found at ${ROOT}/index.html. Run "npm run build" first.`);
  process.exit(1);
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  let path;
  try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (path === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('ok'); return; }
  if (path.endsWith('/')) path += 'index.html';
  // unknown paths fall back to the game itself (it has no client-side routes, but this keeps stray links working)
  const f = files.get(path) ?? files.get('/index.html');
  const accept = String(req.headers['accept-encoding'] ?? '');
  const [body, enc] = f.br && /\bbr\b/.test(accept) ? [f.br, 'br'] : f.gz && /\bgzip\b/.test(accept) ? [f.gz, 'gzip'] : [f.raw, null];
  const headers = {
    'Content-Type': f.type,
    'Content-Length': body.length,
    // the page is one inlined file whose name never changes: always revalidate it; other assets can be cached
    'Cache-Control': f.html ? 'no-cache' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Accept-Encoding',
  };
  if (enc) headers['Content-Encoding'] = enc;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.listen(PORT, HOST, () => console.log(`Riptide serving ${files.size} file(s) from dist/ at http://${HOST}:${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
