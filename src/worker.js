/**
 * Cloudflare Worker adapter for the CORS proxy.
 *
 * Mirrors the Netlify adapter (netlify/functions/proxy.js) and the standalone
 * server (server.js): a thin layer over the SHARED logic in lib/proxy.js so all
 * deployment targets (Netlify / Docker / Cloudflare) behave identically.
 *
 *   - Static UI  → served from ./public via the `ASSETS` binding (env.ASSETS).
 *   - /api/proxy → handled here, delegating to proxyRequest() from lib/proxy.js.
 *
 * Route contract (same everywhere):
 *   GET/POST /api/proxy?url=<target>&method=<m>&body=<b>&contentType=<ct>
 *   (a JSON body { url, method, body, contentType } is also accepted)
 *
 * The browser talks only to this Worker (same origin) → no CORS error is raised.
 * The Worker is the one crossing the origin boundary server-side, and it adds
 * Access-Control-Allow-Origin (echoes the request Origin, else *).
 */

import { proxyRequest, buildCorsHeaders } from '../lib/proxy.js';

/**
 * Parse the incoming Worker request into the `input` shape that
 * proxyRequest() expects ({ url, method, body, contentType, origin }).
 */
async function parseInput(request, url) {
  const q = url.searchParams;
  const input = {
    url: q.get('url') || undefined,
    method: q.get('method') || request.method || 'GET',
    body: q.get('body') || undefined,
    contentType: q.get('contentType') || undefined,
    origin: request.headers.get('origin') || '',
  };

  // Fallback: accept a JSON request body { url, method, body, contentType }.
  if (!input.url && request.method === 'POST') {
    let raw;
    try {
      raw = await request.text();
    } catch (_) {
      return input;
    }
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') {
          input.url = p.url || input.url;
          input.method = p.method || input.method;
          input.body = p.body != null ? p.body : input.body;
          input.contentType = p.contentType || input.contentType;
        }
      } catch (_) {
        /* keep query-based input */
      }
    }
  }
  return input;
}

/**
 * Convert the shared { status, headers, body } result into a Web Response.
 * lib/proxy.js returns `body` as a Node Buffer (a Uint8Array), which is a valid
 * Response body. Headers are lower-cased by the shared module; HTTP headers are
 * case-insensitive, so we can pass them straight through.
 */
function toResponse(result) {
  // body is a Buffer/Uint8Array; pass through as-is (valid BodyInit).
  const body = result && result.body ? result.body : null;
  const headers = result && result.headers ? result.headers : {};
  return new Response(body, {
    status: result ? result.status : 200,
    headers,
  });
}

const staticFallback = (message, status) =>
  new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

export default {
  async fetch(request, env) {
    let url;
    try {
      url = new URL(request.url);
    } catch (_) {
      return staticFallback('Bad request', 400);
    }

    // ── Proxy endpoint: /api/proxy ─────────────────────────────────────────
    if (url.pathname === '/api/proxy' || url.pathname === '/api/proxy/') {
      const origin = request.headers.get('origin') || '';

      // CORS preflight.
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
      }

      const input = await parseInput(request, url);
      const result = await proxyRequest(input);
      return toResponse(result);
    }

    // ── Everything else: serve the shared web UI from ./public ─────────────
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    // Safety net (should not happen with the assets binding configured).
    return staticFallback('Static assets are not configured.', 404);
  },
};
