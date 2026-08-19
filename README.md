# Netlify CORS Proxy

![Docker Image](https://github.com/transfermer/cors-proxy/actions/workflows/docker.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)

<!-- Build badge points at the docker.yml workflow in transfermer/cors-proxy.
     The license badge is static. -->

A minimal, self-hosted CORS proxy you can deploy to Netlify in seconds.

- **`netlify/functions/proxy.js`** – the serverless function. It fetches any
  `http(s)` URL on the server and returns the bytes to the browser with
  `Access-Control-Allow-Origin: *` (so the browser's CORS wall is bypassed).
- **`public/index.html`** – a tiny web UI to pick a URL, method, body, and see
  the response (JSON pretty-printed, images/video rendered inline).
- **`netlify.toml`** – build config + a redirect so the function is reachable
  at the clean route **`/api/proxy`**.

## How it works

```
Browser ──(cross-origin request, CORS headers)──▶ /api/proxy  (Netlify Function)
                                                          │
                                                          ▼  fetch(target)
                                              Upstream site (api.example.com)
                                                          │
Browser ◀──(200, bytes + Access-Control-Allow-Origin: *)──┘
```

The browser talks only to **your** function (same origin), so no CORS error is
raised. The function is the one crossing the origin boundary server-side.

## Project structure

```
cors-proxy/
├── netlify.toml
├── package.json              # scripts: dev / start / deploy
├── Dockerfile                # self-host as a single container
├── docker-compose.yml        # one-command local run (build + up + healthcheck)
├── .env.example              # env template — copy to .env
├── .gitignore
├── .dockerignore
├── LICENSE                   # MIT license
├── .github/
│   └── workflows/docker.yml  # CI: build + push the image to ghcr.io
├── server.js                 # standalone Node server (Docker / self-host)
├── lib/
│   └── proxy.js              # shared proxy logic (Netlify + server both use it)
├── public/
│   └── index.html            # web UI
└── netlify/
    └── functions/
        └── proxy.js          # Netlify function (thin adapter over lib/proxy.js)
```

## Scripts

| Command             | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `npm run dev`       | Run locally with the Netlify CLI (tests the function).    |
| `npm run start`     | Run the standalone server (same code Docker uses), :3000. |
| `npm run deploy`    | Deploy to Netlify.                                        |

The standalone server (`server.js`) uses **no runtime dependencies** — only
Node 18+ built-ins (`http` + global `fetch`). `netlify` is a devDependency,
only needed for `npm run dev` / `npm run deploy`.

## Run locally

Option A — standalone (simplest, no Netlify account needed):

```bash
cd cors-proxy
npm install        # installs the `netlify` CLI devDependency
npm run start      # → http://localhost:3000
```

Option B — Netlify CLI (exercises the serverless function):

```bash
cd cors-proxy
npm install
npm run dev        # → http://localhost:8888
```

In both, the UI is at the root and the endpoint is `/api/proxy`.

## Self-host with Docker

Build and run a single container that serves the UI **and** `/api/proxy`:

```bash
cd cors-proxy
docker build -t cors-proxy .
docker run --rm -p 3000:3000 cors-proxy
# → http://localhost:3000
```

No `Dockerfile`-level build step or dependency install is required at runtime;
the image is a slim `node:20-alpine` with the copied app.

### Or with docker compose

From the project root:

```bash
docker compose up --build        # → http://localhost:3000
HOST_PORT=8080 docker compose up # → http://localhost:8080
```

The compose service has a `healthcheck` (probes the UI at `/`), a
`unless-stopped` restart policy, and an overridable host port via `HOST_PORT`.

To persist these values, copy the template to `.env` (compose reads it
automatically):

```bash
cp .env.example .env   # then edit HOST_PORT / PORT / NODE_ENV
```

## CI/CD with GitHub Actions

`.github/workflows/docker.yml` builds the image and pushes it to the
**GitHub Container Registry** on:

- push to the default branch (tagged `latest`),
- push of a `v*` tag (also tags the semver versions),
- manual run (Actions → *Docker Image* → *Run workflow*).

It uses Buildx with GitHub Actions cache, and tags every build by commit SHA,
branch, and (for tags) semver version. The pushed image is
`ghcr.io/<owner>/<repo>` (lowercased).

After a successful push, pull and run:

```bash
docker pull ghcr.io/<owner>/<repo>:latest
docker run --rm -p 3000:3000 ghcr.io/<owner>/<repo>:latest
```

> Note: the workflow assumes the project is the **repo root** (the `Dockerfile`
> and `.github/` live at the top of the repository). If you keep it in a
> subfolder, set `context:` in the build step to that folder.

## Deploy to Netlify

Pick any one:

1. **Drag & drop** – run `netlify deploy --dir=public` (deploys the static UI)
   *and* make sure the repo/directory has the `netlify/functions` folder so the
   function is bundled. The simplest is: `netlify deploy` from this directory
   (it picks up `netlify.toml`).
2. **Connect a Git repo** – push this folder to GitHub/GitLab and "Import
   existing site" in the Netlify dashboard. It reads `netlify.toml`
   automatically (`publish = public`, function dir `netlify/functions`).
3. **Dashboard import** – drag the whole `cors-proxy/` folder into a new site.

After deploy your site is at `https://<site>.netlify.app`, the UI is at the
root, and the proxy endpoint is:

```
GET/POST /api/proxy?url=<target>&method=GET
```

## Using the endpoint

```bash
# Simple GET
curl "https://your-site.netlify.app/api/proxy?url=https://api.github.com/repos/netlify/cli"

# POST with a JSON body
curl -X POST "https://your-site.netlify.app/api/proxy?url=https://httpbin.org/post&method=POST" \
  -H 'content-type: application/json' \
  -d '{"url":"https://httpbin.org/post","method":"POST","body":{"hello":"world"},"contentType":"application/json"}'
```

From a browser page (same as the UI):

```js
const res = await fetch(
  '/api/proxy?url=' + encodeURIComponent('https://api.example.com/data')
);
const data = await res.json();
```

## Response headers set by the function

- `access-control-allow-origin: *` (echoes the request `Origin` if present)
- `access-control-allow-methods`, `access-control-allow-headers: *`
- `content-type` – forwarded from upstream
- `x-proxy-status` – upstream HTTP status
- `x-upstream-url` – the URL that was actually fetched

## Safety notes (please read)

- **Abuse / cost:** a public CORS proxy is a free relay for anyone. Before
  exposing it publicly, protect it (Netlify Identity/basic-auth, an API key
  header check in the function, or rate limiting) or host it on a non-public
  domain.
- **SSRF:** the function blocks loopback / RFC1918 / link-local hosts and
  non-`http(s)` schemes, including cloud metadata addresses (`169.254.169.254`).
  This is a starting guard, not a complete DNS-rebinding countermeasure.
- **Limits:** responses are capped at **10 MB**. The function timeout is
  Netlify's default (10s on the free plan) — raise it in *Site settings →
  Functions* if you need to proxy slow/large endpoints.
- **Terms of service:** respect the terms and rate limits of sites you proxy;
  don't use this to scrape or hammer other people's services.

## Customizing

- Raise/lower the size cap: `MAX_RESPONSE_BYTES` in `proxy.js`.
- Add an allowlist of target hosts: check `target.hostname` before fetching.
- Require a token: reject requests without a `x-proxy-key` header.
- Serve at a different path: change the `[[redirects]]` block and the `API`
  constant in `index.html`.

## License

Distributed under the [MIT License](./LICENSE).
