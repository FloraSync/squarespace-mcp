# Squarespace MCP

[![CI](https://github.com/FloraSync/squarespace-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/FloraSync/squarespace-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@florasync/squarespace-mcp.svg)](https://www.npmjs.com/package/@florasync/squarespace-mcp)

An MCP server for the current Squarespace Commerce APIs, built for both:

- **Gemini Spark and other web clients** through a hosted HTTPS Streamable HTTP endpoint with OAuth 2.1 discovery, Dynamic Client Registration (DCR), PKCE, and encrypted credential tokens.
- **Gemini CLI, Claude Desktop, Codex, and local clients** through an npm-installed stdio executable.

The server exposes **52 operations generated from Squarespace's official OpenAPI schema**. It is read-only by default and never logs Squarespace credentials.

> This project integrates the public Squarespace Commerce APIs. Squarespace does not expose general page, blog post, form, template, or site-design editing through those APIs, so this server does not pretend those operations exist.

## What it supports

| Area             | Capabilities                                                  | Notes                                                            |
| ---------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Website identity | Read website and OAuth member profiles                        | Available to authenticated requests                              |
| Contacts         | List, query, create, update, delete, and manage address books | Preferred replacement for Profiles                               |
| Analytics        | Retrieve per-contact transaction summaries                    | Query operation despite using HTTP POST                          |
| Discounts        | Full CRUD                                                     | GA as of July 2026                                               |
| Products v2      | Products, variants, product images, image ordering/status     | Physical, service, gift card, and supported download operations  |
| Inventory        | Read inventory and adjust stock                               | Idempotency key generated automatically when omitted             |
| Orders           | List, read, import, and fulfill orders                        | API-key order creation has a separate 100/hour limit             |
| Transactions     | List and retrieve transaction documents                       | Read only                                                        |
| Profiles         | Read legacy profile data                                      | Squarespace marks this API as maintenance mode                   |
| Webhooks         | Create, update, test, rotate, and delete subscriptions        | Squarespace requires an OAuth access token; API keys do not work |

The generated catalog stays below Gemini Enterprise's 100-action guidance and includes MCP safety annotations for read-only and destructive operations.

## Gemini Spark: important runtime distinction

Gemini Spark does **not** run an npm command. Its custom Connected Apps UI accepts an HTTPS MCP server URL. Google requires the server to follow the MCP specification and supports DCR or pre-registered OAuth client credentials. See [Google's Spark custom app instructions](https://support.google.com/gemini/answer/17209137) and [Google's Streamable HTTP hosting guidance](https://cloud.google.com/run/docs/host-mcp-servers).

That is why this package has two transports:

```text
Local MCP client ──stdio──> npx @florasync/squarespace-mcp ──Bearer──> Squarespace

Gemini Spark ──HTTPS/OAuth──> hosted /mcp endpoint ──Bearer──> Squarespace
                                   │
                                   └─ user enters their Squarespace key on the consent page
```

The npm release makes the executable easy to install and pins a known version. A Spark user still needs a deployed copy of its HTTP mode (Cloud Run, another container host, or an equivalent Node host).

## Prerequisites

- Node.js 20 or newer for local use.
- A Squarespace site on a plan that permits Developer API Keys. Squarespace currently documents custom API-key applications under Commerce Advanced.
- A key with only the permissions you need. Squarespace API keys do not expire while the site stays active, so store and revoke them carefully.
- Gemini Spark access for Spark usage. Availability and account restrictions are controlled by Google.

Create a Squarespace key under **Settings → Advanced → Developer API Keys**. The key is shown once. See [Squarespace authentication and permissions](https://developers.squarespace.com/commerce-apis/authentication-and-permissions).

## Local quick start

Run the pinned npm release with your key in the environment:

```bash
SQUARESPACE_API_KEY="your-key" \
  npx -y @florasync/squarespace-mcp@0.1.0
```

Read-only mode is the default. To expose write operations:

```bash
SQUARESPACE_API_KEY="your-key" \
  npx -y @florasync/squarespace-mcp@0.1.0 --read-write
```

An OAuth access token can be supplied as `SQUARESPACE_ACCESS_TOKEN` instead. This is required for webhook subscription operations.

### Gemini CLI configuration

Add this to `~/.gemini/settings.json` or the project's `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "squarespace": {
      "command": "npx",
      "args": ["-y", "@florasync/squarespace-mcp@0.1.0"],
      "env": {
        "SQUARESPACE_API_KEY": "$SQUARESPACE_API_KEY"
      },
      "timeout": 30000,
      "trust": false
    }
  }
}
```

Keep `trust: false` so the client continues to confirm tool calls. Add `"--read-write"` to `args` only when needed.

## Gemini Spark deployment

### 1. Deploy the container

The included `Dockerfile` starts Streamable HTTP mode on `$PORT`. A remote deployment requires:

| Variable                    | Required | Purpose                                                                                                   |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `MCP_PUBLIC_URL`            | Yes      | Exact public HTTPS endpoint ending in `/mcp`; used in OAuth metadata and resource binding                 |
| `MCP_TOKEN_SECRET`          | Yes      | At least 32 characters; encrypts DCR metadata, credentials, auth codes, access tokens, and refresh tokens |
| `SQUARESPACE_MCP_READ_ONLY` | No       | Defaults to `true`; set `false` to publish write tools                                                    |
| `PORT`                      | No       | HTTP port; defaults to `3000`                                                                             |

Build locally:

```bash
docker build -t squarespace-mcp .
docker run --rm -p 3000:3000 \
  -e MCP_PUBLIC_URL="http://localhost:3000/mcp" \
  -e MCP_TOKEN_SECRET="$(openssl rand -base64 32)" \
  squarespace-mcp
```

For Google Cloud Run, put `MCP_TOKEN_SECRET` in Secret Manager and deploy publicly at the Cloud Run ingress layer. The application itself requires OAuth on `/mcp`; public ingress is necessary for Spark to reach the OAuth and MCP routes.

```bash
gcloud run deploy squarespace-mcp \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars MCP_PUBLIC_URL=https://replace-after-first-deploy.invalid/mcp,SQUARESPACE_MCP_READ_ONLY=true \
  --set-secrets MCP_TOKEN_SECRET=squarespace-mcp-token-secret:latest
```

After the first deployment, copy the service URL and update `MCP_PUBLIC_URL` to the exact service URL plus `/mcp`:

```bash
gcloud run services update squarespace-mcp \
  --region us-central1 \
  --set-env-vars MCP_PUBLIC_URL=https://YOUR-SERVICE-URL.run.app/mcp
```

Verify:

```bash
curl https://YOUR-SERVICE-URL.run.app/healthz
curl https://YOUR-SERVICE-URL.run.app/.well-known/oauth-protected-resource/mcp
```

### 2. Connect Spark

1. In the Gemini web app, open **Settings & help → Connected Apps**.
2. Under **Custom apps for Spark**, add `https://YOUR-SERVICE-URL.run.app/mcp`.
3. Spark discovers the OAuth metadata and dynamically registers itself.
4. On the FloraSync authorization page, paste a Squarespace API key or OAuth access token.
5. The server validates the credential directly against Squarespace and redirects back to Gemini.

The credential is never placed in a query string and is not written to a database. It is encrypted into short-lived, resource-bound bearer tokens with AES-256-GCM. Access tokens last one hour; rotating refresh tokens last up to 30 days.

### Remote security model

This remote mode is designed for a self-hosted deployment:

- Use HTTPS only. The SDK rejects non-HTTPS issuer URLs except localhost development.
- Keep `MCP_TOKEN_SECRET` stable and secret. Rotating it is the immediate way to invalidate every registration and token.
- OAuth authorization codes and refresh tokens are one-time-use within a running process. Replay and revocation caches are process-local; if the service restarts, rotate `MCP_TOKEN_SECRET` when immediate global revocation is required.
- The deployment stores no API key database. A credential is present only in the authorization POST body, server memory, and authenticated encrypted tokens.
- Keep read-only mode enabled unless the deployment genuinely needs writes.
- Restrict Cloud Run logs and never add request-body logging middleware.

For a public multi-tenant SaaS offering, replace the self-contained provider with a durable authorization service and persistent revocation store before production use.

## Tool behavior

- Inputs are validated server-side against schemas derived from the official Squarespace OpenAPI document.
- Required idempotency keys are automatically generated. Supply `idempotencyKey` yourself when intentionally retrying the same inventory adjustment or order import.
- Pagination cursors are returned unchanged. Pass `cursor` to the same list tool for the next page.
- Squarespace errors include status, `contextId`, and `Retry-After` details when available; credentials are redacted.
- Squarespace's global documented limit is 300 requests/minute (five/second). A `429` has a one-minute cooldown. See [rate limits](https://developers.squarespace.com/commerce-apis/rate-limits).

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
npm run pack:dry
```

Update the generated catalog when Squarespace changes its schema:

```bash
npm run sync:api
npm test
```

Review the generated diff before committing it. The generator downloads Squarespace's current official schema and produces `src/generated/operations.ts`.

## Releases

Releases are tag-driven. A tag such as `v0.1.0` must exactly match `package.json` and `server.json`. The release workflow:

1. reruns type checking, formatting, lint, coverage, build, package inspection, and audit;
2. publishes the public npm package with provenance;
3. publishes `ghcr.io/florasync/squarespace-mcp:<version>` and `:latest`;
4. creates a GitHub Release.

The initial npm publish needs a granular `NPM_TOKEN` GitHub secret with read/write package access and **Bypass 2FA** enabled. After `0.1.0` exists, configure npm Trusted Publishing for:

- Organization: `FloraSync`
- Repository: `squarespace-mcp`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

Then remove the long-lived `NPM_TOKEN` and set the package publishing policy to disallow tokens. npm requires Node 22.14+ and npm 11.5.1+ for trusted publishing; this workflow uses Node 24 and npm 11.

`server.json` is ready for publication to the official MCP Registry after the first npm release.

## Sources and status

- [Squarespace Commerce APIs](https://developers.squarespace.com/commerce-apis/overview)
- [Squarespace authentication and permissions](https://developers.squarespace.com/commerce-apis/authentication-and-permissions)
- [Squarespace API changelog](https://developers.squarespace.com/commerce-apis/changelog)
- [Gemini Spark custom apps](https://support.google.com/gemini/answer/17209137)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)

Squarespace is a trademark of Squarespace, Inc. This project is independently maintained by FloraSync and is not endorsed by Squarespace or Google.

## License

MIT
