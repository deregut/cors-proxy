# Self-host the CORS proxy (web UI + /api/proxy) in a single container.
# Uses only Node.js built-ins (http + global fetch), so there are NO runtime
# dependencies and no `npm install` network step is strictly required.
FROM node:20-alpine

WORKDIR /app

# No runtime dependencies: the app uses only Node.js built-ins (node:http,
# node:fs, node:path, node:url) and the global fetch (Node 18+). There is
# nothing to `npm install`, so we skip it entirely — an install step here was
# the source of the build failure. If you later add entries to `dependencies`
# in package.json, commit a package-lock.json and switch to `RUN npm ci`.
COPY package.json ./

# Application code: shared logic, the standalone server, and the web UI.
COPY lib ./lib
COPY server.js ./
COPY public ./public

# Netlify assets (not needed at runtime; kept for parity / `netlify dev`).
COPY netlify ./netlify
COPY netlify.toml ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Run the standalone server (same code path the container exposes).
CMD ["node", "server.js"]
