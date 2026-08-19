// Shared CORS-proxy logic.
// Framework-agnostic: used by BOTH the Netlify function (netlify/functions/proxy.js)
// and the standalone Docker server (server.js). No Netlify-specific code here.

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB safety cap

const PRIVATE_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

/** Basic SSRF guard: block loopback / RFC1918 / link-local / local names. */
export function isPrivateOrBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (PRIVATE_HOSTS.has(host)) return true;
  if (host.endsWith('.local')) return true;
  if (host.endsWith('.localhost')) return true;
  if (host.endsWith('.internal')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  if (host.startsWith('169.254.')) return true; // link-local (incl. cloud metadata)
  const m = host.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true; // 172.16.0.0/12
  return false;
}

/** CORS headers. Echoes the request Origin if present, else wildcard. */
export function buildCorsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods':
      'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-max-age': '86400',
  };
}

function jsonError(baseHeaders, status, message) {
  return {
    status,
    headers: { ...baseHeaders, 'content-type': 'text/plain; charset=utf-8' },
    body: Buffer.from(message, 'utf8'),
  };
}

/**
 * Proxy a request to `input.url` and return the upstream bytes.
 *
 * @param {object} input
 * @param {string}   [input.url]         Target URL to fetch.
 * @param {string}   [input.method]      HTTP method (default GET).
 * @param {string|object|null} [input.body]  Request body (string or JSON-able).
 * @param {string}   [input.contentType] Content-Type for a non-GET body.
 * @param {string}   [input.origin]      Request Origin, for the CORS header.
 * @returns {Promise<{status:number, headers:Record<string,string>, body:Buffer}>}
 */
export async function proxyRequest(input) {
  const baseHeaders = buildCorsHeaders(input && input.origin);

  let url = input ? input.url : undefined;
  const method = ((input && input.method) || 'GET').toUpperCase();
  const body = (input && input.body != null) ? input.body : null;
  const contentType = (input && input.contentType) || null;

  if (!url || typeof url !== 'string') {
    return jsonError(
      baseHeaders,
      400,
      'Missing "url". Use ?url=<target> or JSON body { url }.'
    );
  }

  let target;
  try {
    target = new URL(url);
  } catch (_) {
    return jsonError(baseHeaders, 400, 'Invalid URL: ' + url);
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return jsonError(baseHeaders, 400, 'Only http:// and https:// URLs are allowed.');
  }

  if (isPrivateOrBlockedHost(target.hostname)) {
    return jsonError(
      baseHeaders,
      403,
      'Host blocked (private/internal address): ' + target.hostname
    );
  }

  const reqHeaders = {
    accept: '*/*',
    'user-agent': 'Mozilla/5.0 (compatible; CORS-Proxy)',
  };
  const hasBody = method !== 'GET' && method !== 'HEAD' && body != null;
  if (hasBody) {
    reqHeaders['content-type'] = contentType || 'application/json';
  }
  const outBody = hasBody
    ? (typeof body === 'string' ? body : JSON.stringify(body))
    : undefined;

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method,
      headers: reqHeaders,
      body: outBody,
      redirect: 'follow',
    });
  } catch (err) {
    return jsonError(
      baseHeaders,
      502,
      'Upstream fetch failed: ' + (err && err.message ? err.message : String(err))
    );
  }

  const declaredLength = Number(upstream.headers.get('content-length') || 0);
  if (declaredLength && declaredLength > MAX_RESPONSE_BYTES) {
    return jsonError(
      baseHeaders,
      413,
      'Response too large (limit ' + MAX_RESPONSE_BYTES + ' bytes).'
    );
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.length > MAX_RESPONSE_BYTES) {
    return jsonError(
      baseHeaders,
      413,
      'Response too large (limit ' + MAX_RESPONSE_BYTES + ' bytes).'
    );
  }

  return {
    status: upstream.status,
    headers: {
      ...baseHeaders,
      'content-type':
        upstream.headers.get('content-type') || 'application/octet-stream',
      'x-proxy-status': String(upstream.status),
      'x-upstream-url': target.toString(),
    },
    body: buf,
  };
}
