# ☁️ Deploying Squarespace MCP to Google Cloud Run

This guide uses **OAuth HTTP mode** for browser-based MCP clients. Each user enters their own Squarespace credential during login. `/mcp` requires that user's issued bearer token on every call; Cloud Run public ingress does not grant anonymous store access.

Use the current source for the OAuth browser-submission fix and the additional API-key modes. The published `0.1.0` container predates these changes.

## Prerequisites

- A Google Cloud project with billing enabled and the [gcloud CLI](https://cloud.google.com/sdk/docs/install).
- Permission to deploy Cloud Run services, create service accounts, grant the documented roles, and act as the build and runtime accounts.
- A local checkout of this repository. Source deployment builds the included Node.js 24 Dockerfile.
- A Squarespace credential for browser login. OAuth mode does not need that credential in the server environment.

## 1. Set the Project and Enable Services

```bash
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export SERVICE="squarespace-mcp"
export TOKEN_SECRET="MCP_TOKEN_SECRET"
export RUNTIME_SA="squarespace-mcp-run@${PROJECT_ID}.iam.gserviceaccount.com"
export BUILD_SA="squarespace-mcp-build@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com \
  --project "$PROJECT_ID"
```

## 2. Create Dedicated Service Accounts and the Secret

Run account and secret creation once. Reuse existing accounts and secret versions when updating a deployment.

```bash
gcloud iam service-accounts create squarespace-mcp-run --project "$PROJECT_ID"
gcloud iam service-accounts create squarespace-mcp-build --project "$PROJECT_ID"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/run.builder"

openssl rand -base64 32 | \
  gcloud secrets create "$TOKEN_SECRET" --data-file=- --project "$PROJECT_ID"

gcloud secrets add-iam-policy-binding "$TOKEN_SECRET" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --project "$PROJECT_ID"
```

Only the runtime account needs access to the token secret. The commands below pin secret version `1`; use the intended version if the secret already exists. Google recommends pinning secret versions when supplying secrets as environment variables. See [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

## 3. Deploy from Source

Run this from the repository root. For an existing service, use its current public MCP URL instead of the placeholder to preserve OAuth issuer and resource URLs.

```bash
gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --service-account "$RUNTIME_SA" \
  --build-service-account="projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \
  --allow-unauthenticated \
  --port 3000 --cpu 1 --memory 512Mi \
  --min-instances 0 --max-instances 1 \
  --update-env-vars "AUTHMODE=oauth,MCP_PUBLIC_URL=https://placeholder.invalid/mcp,SQUARESPACE_MCP_READ_ONLY=true" \
  --update-secrets "MCP_TOKEN_SECRET=${TOKEN_SECRET}:1"
```

`--allow-unauthenticated` permits public ingress to OAuth discovery and consent. The application authenticates `/mcp` itself. The build account's `roles/run.builder` role is documented in [Cloud Run source deployment](https://docs.cloud.google.com/run/docs/deploying-source-code).

OAuth replay and revocation tracking is currently in memory. Limiting instances does not preserve that state across restarts or provide global revocation. Read the [security limitations](../SECURITY.md#oauth-replay-and-revocation-limits) before scaling.

## 4. Set the Public URL on First Deployment

```bash
SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format='value(status.url)')

gcloud run services update "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --update-env-vars "MCP_PUBLIC_URL=${SERVICE_URL}/mcp"
```

Keep using the same public URL on later deployments. Changing it changes the OAuth resource identity and can require clients to reconnect.

## 5. Verify and Connect

```bash
# Health JSON; keep the trailing slash on Cloud Run.
curl --fail-with-body "$SERVICE_URL/healthz/"

# OAuth discovery metadata.
curl --fail-with-body "$SERVICE_URL/.well-known/oauth-protected-resource/mcp"

# No bearer token: expect HTTP 401.
curl -i -X POST "$SERVICE_URL/mcp" \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Add `${SERVICE_URL}/mcp` to your MCP client and start its OAuth login. Enter your Squarespace credential on the consent page. After validation, the completion page returns you to the client; use **Continue to your app** if automatic navigation does not run.

If a browser still reports a `form-action` CSP error, close the old authorization tab and start a fresh login. Open that login on the same machine as a client using a localhost callback. The current completion page ends the form submission before navigating to the client callback, so callback redirects do not inherit the form's submission restriction.

## Existing FloraSync Deployment

The current service is in project `florasync-cc`, region `us-central1`:

- Service: `squarespace-mcp`
- Public MCP URL: `https://squarespace-mcp-6jwboz4p3q-uc.a.run.app/mcp`
- Secret binding: `MCP_TOKEN_SECRET=MCP_TOKEN_SECRET:1`
- Runtime account: `squarespace-mcp-run@florasync-cc.iam.gserviceaccount.com`
- Build account: `squarespace-mcp-build@florasync-cc.iam.gserviceaccount.com`
- Read-only mode is enabled.

The existing configuration remains in OAuth mode without a new secret. Set `AUTHMODE=oauth` explicitly on the next deployment. Preserve the public URL above even if `gcloud` displays the alternative Cloud Run hostname.

## Rotating the OAuth Secret

Add a new version, note its version number, then deploy it to running instances:

```bash
openssl rand -base64 32 | \
  gcloud secrets versions add "$TOKEN_SECRET" --data-file=- --project "$PROJECT_ID"

# Replace 2 with the version just created.
gcloud run services update "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --update-secrets "MCP_TOKEN_SECRET=${TOKEN_SECRET}:2"

gcloud run services update-traffic "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" --to-latest
```

Secret values are read at process startup. Adding a version by itself does not invalidate current tokens. Retire old revisions and any tagged URLs using the previous secret. Clients must register and authenticate again after the rollout.

## Updating and Alternative Authentication

To update the server, rerun source deployment with the current public URL and intended secret version. To enable write tools, set `SQUARESPACE_MCP_READ_ONLY=false` only when needed.

For clients that send a fixed bearer key, see the [HTTP authentication modes](../README.md#http-authentication-modes). Those modes require a separate server-side Squarespace credential. `secure-sqlite` needs persistent SQLite storage; Cloud Run's local filesystem is ephemeral, so the container's `/data` path alone is insufficient.
