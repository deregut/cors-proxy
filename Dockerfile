# Self-host the CORS proxy (web UI + /api/proxy) in a single container.
# Uses only Node.js built-ins (http + global fetch), so there are NO runtime
# dependencies and no `npm install` network step is strictly required.
FROM node:20-alpine

WORKDIR /app

# Copy manifest first and install runtime deps only (a no-op today, but keeps
# the build valid and forward-compatible if you add `dependencies` later).
COPY package.json ./
RUN npm install --omit=dev

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
