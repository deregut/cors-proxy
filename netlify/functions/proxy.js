// Netlify Function: thin adapter around the shared proxy logic in lib/proxy.js.
// Public route (via netlify.toml redirect): /api/proxy?url=<target>&method=<m>
import { proxyRequest, buildCorsHeaders } from '../../lib/proxy.js';

export const handler = async (event) => {
  const h = event.headers || {};
  const origin = h.origin || h.Origin || '';

  // Handle CORS preflight.
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: buildCorsHeaders(origin), body: '' };
  }

  const query = event.queryStringParameters || {};
  let input = {
    url: query.url,
    method: query.method,
    body: query.body,
    contentType: query.contentType,
    origin,
  };

  // Also support a JSON request body: { url, method, body, contentType }.
  if (!input.url && event.body) {
    try {
      const p = JSON.parse(event.body);
      if (p && typeof p === 'object') {
        input = {
          url: p.url,
          method: p.method,
          body: p.body,
          contentType: p.contentType,
          origin,
        };
      }
    } catch (_) {
      /* keep query-based input */
    }
  }

  const res = await proxyRequest(input);
  return {
    statusCode: res.status,
    headers: res.headers,
    body: res.body.toString('base64'),
    isBase64Encoded: true,
  };
};
