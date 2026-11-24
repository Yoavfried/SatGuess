# Hosting the game

The game can run on Cloudflare Workers with a SQLite-backed Durable Object. The included Node server remains available for local development.

## Build and publish

Use Node.js 24+, then install the pinned development tools:

```sh
npm ci
npm test
npm run check
npm run worker:check
```

`worker:check` performs a dry-run build without publishing. It copies only the public asset allowlist into `.worker/public/mappa/` and builds a compact private catalog for the Worker bundle. It never publishes `dist/places.json`, local SQLite files or exported guesses as static assets. The open place database remains available through this repository under its data license.

Authenticate with `npx wrangler whoami`. If needed, use `npx wrangler login`. When the login can access multiple accounts, set `CLOUDFLARE_ACCOUNT_ID` to the intended account in the deployment environment; account IDs and credentials do not belong in this repository.

```sh
npm run worker:deploy
```

The first deployment creates the `SatGuessGame` SQLite Durable Object namespace through the checked-in migration. Later deployments reuse the namespace and the fixed `game-v1` object, preserving browser identities, daily challenges and attempts. Do not rename or remove this binding/object to deploy a routine code update.

The catalog is validated and compacted at build time. It is parsed lazily inside the Durable Object rather than in the edge router. The object runs the same synchronous game service, scoring rules and repository guards used by the local Node server. Static assets bypass the database.

The configuration uses no paid-only products and does not upgrade a Cloudflare plan. Usage remains subject to the selected account's plan and quotas. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Serve a separate page on an existing website

The public mount is `/mappa/`. The slashless URL redirects to it. `PUBLIC_ORIGIN` in `wrangler.jsonc` is the trusted website origin used for POST validation. Anonymous cookies are Secure, HttpOnly, host-only and scoped to `/mappa`.

For an existing Vercel website, add a single external rewrite matching only the game prefix, preserving that prefix at the destination:

```json
{
  "src": "^(/mappa(?:/.*)?)$",
  "has": [{ "type": "host", "value": "yoavfried.com" }],
  "dest": "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev$1",
  "respectOriginCacheControl": true
}
```

Use the exact Worker URL returned by deployment. Add this rule alongside existing routes rather than replacing them. This requires no homepage navigation, backlink, nameserver change or whole-domain proxy. Game responses request `noindex`; the URL remains publicly accessible to anyone who has it.

API responses use `Cache-Control: no-store` and `Vary: Cookie`. Preserve the origin's cache-control headers when configuring the proxy. Check the homepage, game page, cookie persistence, POST requests and private-file 404s after publishing.

## Test the Cloudflare runtime locally

```sh
npm run worker:dev -- --port 4174 --persist-to .data/worker-preview
```

Open `http://127.0.0.1:4174/mappa/`. The local Durable Object state stays in the ignored `.data/` directory. Production storage is separate; local test records are not uploaded by deployment.
