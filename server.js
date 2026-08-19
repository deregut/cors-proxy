// Standalone Node.js server (no external dependencies) for self-hosting.
// Serves the web UI from public/ and implements /api/proxy using lib/proxy.js.
// This is what the Docker container runs.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proxyRequest, buildCorsHeaders } from './lib/proxy.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = resolve(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 2 * 1024 * 1024; // 2 MB limit for reading a JSON body

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function originOf(req) {
  return req.headers.origin || req.headers.Origin || '';
}

function readBody(req, limit) {
  return new Promise((resolveP, rejectP) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        rejectP(new Error('body too large'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => resolveP(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectP);
  });
}

async function handleProxy(req, res) {
  const base = `http://${req.headers.host || 'localhost'}`;
  const urlObj = new URL(req.url, base);

  const input = {
    url: urlObj.searchParams.get('url'),
    method: (urlObj.searchParams.get('method') || req.method || 'GET'),
    body: urlObj.searchParams.get('body'),
    contentType: urlObj.searchParams.get('contentType'),
    origin: originOf(req),
  };

  // Fallback: accept a JSON body { url, method, body, contentType }.
  if (!input.url && req.method === 'POST') {
    const raw = await readBody(req, MAX_BODY);
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        input.url = p.url;
        input.method = p.method;
        input.body = p.body;
        input.contentType = p.contentType;
      }
    } catch (_) {
      /* keep query-based input */
    }
  }

  const result = await proxyRequest(input);
  res.writeHead(result.status, result.headers);
  res.end(result.body);
}

async function serveStatic(req, res) {
  const base = `http://${req.headers.host || 'localhost'}`;
  const urlObj = new URL(req.url, base);
  let pathname = decodeURIComponent(urlObj.pathname);
  if (pathname === '/') pathname = '/index.html';

  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  let st;
  try {
    st = await stat(filePath);
  } catch (_) {
    res.writeHead(404);
    return res.end('Not found');
  }
  if (!st.isFile()) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const mime = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const data = await readFile(filePath);
  res.writeHead(200, { 'content-type': mime, 'content-length': st.size });
  res.end(req.method === 'HEAD' ? undefined : data);
}

const server = createServer(async (req, res) => {
  try {
    const base = `http://${req.headers.host || 'localhost'}`;
    const urlObj = new URL(req.url, base);

    if (urlObj.pathname === '/api/proxy') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, buildCorsHeaders(originOf(req)));
        return res.end();
      }
      return await handleProxy(req, res);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return await serveStatic(req, res);
    }

    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Server error: ' + (err && err.message ? err.message : String(err)));
  }
});

server.listen(PORT, () => {
  console.log(`CORS proxy listening on http://0.0.0.0:${PORT}`);
});
