# FCM Push Notification Service

A small, focused, production-grade **Node.js + Express + TypeScript** service whose only
job is to send push notifications through **Firebase Cloud Messaging (FCM)** using the
**Firebase Admin SDK** (service-account auth — _not_ the deprecated legacy server key).

---

## Features

- `POST /api/v1/notifications/send` — send to a single device token, an array of tokens
  (multicast, max 500), or a topic.
- Service-account auth via the Firebase Admin SDK, initialized **exactly once** behind a
  singleton getter. Credentials are passed explicitly (never via implicit
  `GOOGLE_APPLICATION_CREDENTIALS`), so dev and prod behave identically.
- Static `x-api-key` header auth for inbound requests (constant-time comparison).
- Strict request validation with [Zod](https://zod.dev) — malformed requests get a `400`
  and **never reach FCM**.
- Structured JSON logging via [pino](https://getpino.io) — device tokens and request
  bodies are **never** logged (only route, status, duration, target shape, and counts).
- Per-token FCM error reporting (via `sendEachForMulticast`) so callers can prune
  invalid / unregistered tokens.
- `helmet` security headers + `express-rate-limit` abuse protection.

## Tech stack

Node.js 20+, TypeScript (strict), Express 4, firebase-admin, zod, pino + pino-http,
helmet, express-rate-limit, dotenv, tsx (dev), vitest, eslint + @typescript-eslint,
prettier. Build artefact is compiled JS in `dist/` via `tsc`; production runs the
compiled output (`npm start`), not tsx.

## Project structure

```
src/
  config/      env.ts (Zod-validated env), firebase.ts (Admin SDK singleton)
  middleware/  apiKey.ts, errorHandler.ts, validate.ts, rateLimit.ts
  routes/      health.routes.ts, notifications.routes.ts
  controllers/ notification.controller.ts
  services/    notification.service.ts   (all FCM send logic)
  schemas/     notification.schema.ts     (Zod schemas + inferred types)
  utils/       logger.ts, errors.ts
  app.ts       Express app factory (no listen())
  server.ts    imports app, calls listen()
public/        index.html + app.js  (browser admin UI, served at /)
tests/         notification.service.test.ts
render.yaml    Render.com Blueprint
```

---

## Setup

### Manual Tasks (you must do these — they cannot be automated)

1. Firebase Console → Project Settings → Service accounts tab →
   "Generate new private key" → save the downloaded JSON as
   ./secrets/firebase-service-account.json (or base64 it into
   FIREBASE_SERVICE_ACCOUNT_BASE64 for deployment).

2. Firebase Console → Project Settings → Cloud Messaging tab →
   confirm "Firebase Cloud Messaging API (V1)" is ENABLED. The
   "Cloud Messaging API (Legacy)" should remain DISABLED.

3. Generate a strong random string for SERVER_API_KEY (e.g.
   `openssl rand -hex 32`) and put it in .env.

4. Obtain a real FCM device token from the mobile app for end-to-end
   testing. The Firebase Console's "Cloud Messaging → Send your first
   message" tester can verify the project is wired correctly, but the
   final smoke test uses this server hitting that token.

5. (iOS only, if not already done) Firebase Console → Project Settings
   → Cloud Messaging → APNs Authentication Key uploaded.

### Install & run

```bash
npm install
cp .env.example .env      # then fill SERVER_API_KEY and the Firebase credential

# Local dev (tsx, hot reload):
npm run dev

# Production (compiled output):
npm run build && npm start
```

The server logs (structured JSON) the resolved Firebase `project_id` once at startup. If
no credential is configured, it still boots and serves `/health`; sends then fail with a
clear `FIREBASE_NOT_CONFIGURED` error until a credential is provided.

---

## Environment variables

| Variable                          | Required | Default                                   | Description                                                                               |
| --------------------------------- | -------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `PORT`                            | no       | `3000`                                    | HTTP port.                                                                                |
| `NODE_ENV`                        | no       | `development`                             | `development` \| `test` \| `production`.                                                  |
| `LOG_LEVEL`                       | no       | `info`                                    | pino level: `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`\|`silent`.                 |
| `SERVER_API_KEY`                  | **yes**  | —                                         | Static key callers must send as `x-api-key`. Generate via `openssl rand -hex 32`.         |
| `FIREBASE_SERVICE_ACCOUNT_PATH`   | one-of\* | `./secrets/firebase-service-account.json` | Path to the service-account JSON on disk (local dev).                                     |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | one-of\* | —                                         | Base64-encoded service-account JSON (preferred for deployment). **Takes precedence.**     |
| `RATE_LIMIT_WINDOW_MS`            | no       | `60000`                                   | Rate-limit window, ms.                                                                    |
| `RATE_LIMIT_MAX`                  | no       | `60`                                      | Max requests per window per client IP.                                                    |
| `TRUST_PROXY`                     | no       | `false`                                   | `true`, `false`, or a number of trusted proxy hops (see [Reverse proxy](#reverse-proxy)). |
| `ENABLE_UI`                       | no       | `true`                                    | Serve the browser admin UI at `/`. Set `false` for a headless, API-only deploy.           |

\* **Credential resolution.** Provide **exactly one** credential form. If both are set,
the **base64** form wins. Startup behavior is _fail-fast on broken, defer on absent_:

- A credential that is **present but invalid** (unparseable JSON, or missing
  `project_id` / `client_email` / `private_key`) → the server **throws at startup**.
- A **base64** that fails to decode → **throws at startup**.
- A configured **path whose file does not exist yet**, or **no** credential at all →
  treated as absent: the server boots, `/health` works, and `/send` returns a clear
  `FIREBASE_NOT_CONFIGURED` error until a credential is supplied.

To produce the base64 form:

```bash
base64 -i ./secrets/firebase-service-account.json    # macOS/Linux
```

---

## API

All responses (success and error) are JSON. Errors use a consistent shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [ ... ] } }
```

| `code`                    | HTTP | When                                         |
| ------------------------- | ---- | -------------------------------------------- |
| `VALIDATION_ERROR`        | 400  | Body failed validation / malformed JSON.     |
| `UNAUTHORIZED`            | 401  | Missing or invalid `x-api-key`.              |
| `RATE_LIMITED`            | 429  | Too many requests.                           |
| `FCM_ERROR`               | 502  | FCM rejected the request (reason sanitised). |
| `FIREBASE_NOT_CONFIGURED` | 503  | No Firebase credential configured.           |
| `NOT_FOUND`               | 404  | Unknown route.                               |
| `INTERNAL_ERROR`          | 500  | Unexpected server error.                     |

### `GET /health`

No auth. → `200`

```json
{ "status": "ok", "uptime": 123 }
```

### `POST /api/v1/notifications/send`

Headers: `x-api-key: <SERVER_API_KEY>`, `Content-Type: application/json`.

Body (`target` is exactly one of `token` | `tokens` | `topic`):

```jsonc
{
  "title": "string (1..100)",
  "body": "string (1..500)",
  "data": { "key": "value" }, // optional; ALL values must be strings
  "target": { "token": "..." }, // single device
  //   | { "tokens": ["...", "..."] }   // multicast (max 500)
  //   | { "topic": "news" }            // topic
}
```

Success responses:

- **Single token:** `200 { "successCount": 1, "messageId": "..." }`
- **Multicast:** `200 { "successCount": N, "failureCount": M, "failedTokens": [ { "token": "...", "error": "messaging/registration-token-not-registered" } ] }`
- **Topic:** `200 { "messageId": "..." }`

Error responses: `400` (validation), `401` (api key), `429` (rate limit), `502`
(FCM error), `503` (no credential configured).

---

## Examples

> Tip: export your key first — `export SERVER_API_KEY=$(grep ^SERVER_API_KEY .env | cut -d= -f2)`

### Single token

```bash
curl -X POST http://localhost:3000/api/v1/notifications/send \
  -H "x-api-key: $SERVER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Build complete",
    "body":  "Your build finished successfully",
    "data":  { "type": "build", "buildId": "42" },
    "target": { "token": "DEVICE_FCM_TOKEN" }
  }'
```

### Multicast (array of tokens)

```bash
curl -X POST http://localhost:3000/api/v1/notifications/send \
  -H "x-api-key: $SERVER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Heads up",
    "body":  "Message for several devices",
    "target": { "tokens": ["DEVICE_TOKEN_1", "DEVICE_TOKEN_2"] }
  }'
```

`failedTokens[].error` carries the FCM error code (e.g.
`messaging/registration-token-not-registered`) — prune those tokens from your store.

### Topic

```bash
curl -X POST http://localhost:3000/api/v1/notifications/send \
  -H "x-api-key: $SERVER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "News",
    "body":  "Something happened",
    "target": { "topic": "news" }
  }'
```

### Smoke test

Once you have a **real FCM device token** (Manual Task 4) and a configured service
account, run:

```bash
curl -X POST http://localhost:3000/api/v1/notifications/send \
  -H "x-api-key: $SERVER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test",
    "body":  "Hello from the server",
    "target": { "token": "REAL_FCM_TOKEN_HERE" }
  }'
```

A `200` with `{ "successCount": 1, "messageId": "..." }` and a notification arriving on
the device confirms the full path is wired correctly.

---

## Web UI

When `ENABLE_UI=true` (the default), a small browser form is served at the site root
(`/`) for manually triggering notifications — handy for testing and ad-hoc sends.

1. Open the server URL in a browser (e.g. `http://localhost:3000/`, or your Render URL).
2. Paste your `SERVER_API_KEY` into the **API key** field (optionally tick "remember" —
   stored in that browser's `localStorage` only).
3. Fill in title/body, pick a target (single token / multiple tokens / topic), optionally
   add a JSON **data** payload, and click **Send**. The HTTP status and JSON response are
   shown below the form.

**Security notes.**

- The page loads without a key, but **sending still requires `x-api-key`** — loading the
  UI grants no send capability on its own.
- The UI calls the API **same-origin**, so it works under the strict Helmet CSP with no
  extra config. (The "Server URL" field is only for opening the page from a different
  origin, e.g. a local file; leave it blank when using the hosted UI.)
- For a hardened deployment, set `ENABLE_UI=false` and drive the API with `curl` / your
  backend, and/or put the service behind an IP allowlist or auth proxy.

---

## Reverse proxy

`express-rate-limit` keys limits by client IP. Behind a reverse proxy / load balancer,
the direct connection IP is the proxy, so you must tell Express to trust the proxy and
read the real client IP from `X-Forwarded-For`.

Set `TRUST_PROXY` to the **number of proxy hops** in front of the app (e.g. `1` for a
single nginx/ELB). Prefer a number over `true`: a blanket `true` is permissive and
`express-rate-limit` will warn about it, because a client could spoof `X-Forwarded-For`
to dodge the limit. Leave `TRUST_PROXY=false` when the server is exposed directly.

---

## Deploy to Render (render.com)

This repo includes a [`render.yaml`](./render.yaml) Blueprint and a `.node-version` pin.
Render builds with `npm ci --include=dev && npm run build`, runs `npm start`, injects
`PORT` automatically, and health-checks `/health`.

### Manual tasks (you do these)

1. **Firebase** — complete the **Manual Tasks** from [Setup](#setup) above (service
   account, FCM API v1 enabled, APNs key for iOS).

2. **Base64-encode the service account** for the env var (do not deploy the JSON file):

   ```bash
   base64 -i ./secrets/firebase-service-account.json | tr -d '\n'   # copy the output
   ```

3. **Push the repo to a Git remote** (Render deploys from GitHub/GitLab/Bitbucket):

   ```bash
   git init && git add -A && git commit -m "FCM notification service"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

   `.gitignore` already excludes `.env`, `secrets/`, `node_modules`, and `dist`, so no
   secrets are pushed.

4. **Create the service** — Render dashboard → **New + → Blueprint** → select your repo
   (Render reads `render.yaml`).

5. **Set the two secret env vars** in the Render dashboard (they are `sync: false` in the
   Blueprint, so Render prompts for them):
   - `SERVER_API_KEY` — e.g. `openssl rand -hex 32`
   - `FIREBASE_SERVICE_ACCOUNT_BASE64` — the base64 string from step 2

6. **Deploy, then verify:**

   ```bash
   curl https://<your-service>.onrender.com/health      # → {"status":"ok","uptime":N}
   ```

   Then open `https://<your-service>.onrender.com/` for the UI, or run the smoke-test
   curl against the Render URL with a real device token.

### Notes

- `render.yaml` pre-sets `NODE_ENV=production`, `TRUST_PROXY=1` (Render runs behind a
  proxy — see [Reverse proxy](#reverse-proxy)), the rate-limit defaults, and
  `ENABLE_UI=true`.
- The **free** plan spins down after inactivity, so the first request after idle has a
  few-second cold start. Use `plan: starter` (paid) to keep it warm.
- `region` defaults to `oregon`; change it in `render.yaml` (e.g. `singapore`) for lower
  latency.
- On Render, use the **base64** credential form — there is no `secrets/` directory in the
  deployed repo.

### Troubleshooting

**`Error: Cannot find module '/opt/render/project/src/dist/server.js'`** (start crashes,
"No open ports detected"). The TypeScript was not compiled during build, so `dist/` is
missing (it is git-ignored and must be built on Render). This means the **Build Command
did not run `npm run build`** — usually because the service was created manually, so
Render used its default `npm install`.

Fix it in the Render dashboard → **Settings → Build & Deploy**:

- **Build Command:** `npm install --include=dev && npm run build`
- **Start Command:** `npm start`

then **Manual Deploy → Clear build cache & deploy**. (`--include=dev` is required because
`NODE_ENV=production` otherwise skips `typescript`, which lives in devDependencies.)
Alternatively, recreate the service via **New + → Blueprint** so `render.yaml` supplies
these automatically.

---

## Secret handling

- The Firebase service-account JSON is a **secret**. **Never commit it.** The `secrets/`
  directory and all `.env*` files (except `.env.example`) are git-ignored.
- In deployment, prefer `FIREBASE_SERVICE_ACCOUNT_BASE64` (an env var injected by your
  secret manager) over a file on disk.
- The service logs only the `project_id` and credential source at startup — never the
  full service account, and never device tokens or request bodies.

---

## Scripts

| Script              | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Run with tsx + hot reload (`src/server.ts`) |
| `npm run build`     | Compile TypeScript to `dist/`               |
| `npm start`         | Run the compiled server (`dist/server.js`)  |
| `npm run typecheck` | Type-check without emitting                 |
| `npm run lint`      | ESLint over `src` and `tests`               |
| `npm run format`    | Prettier write                              |
| `npm test`          | Run the Vitest suite                        |

## Testing

Unit tests (`npm test`) cover the FCM send service with the Firebase layer **mocked** —
no real FCM is contacted and `initializeApp()` is never called. Covered: single-token
send, multicast with partial failure, invalid-token error mapping, and topic send.
