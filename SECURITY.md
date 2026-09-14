# 🛡️ Security & Privacy Policy

## Supported Versions and Reporting

Security fixes are released for the latest published version of `@florasync/squarespace-mcp`.

Report vulnerabilities through [GitHub Private Vulnerability Reporting](https://github.com/FloraSync/squarespace-mcp/security/advisories/new). Never include real API keys, OAuth tokens, customer data, or order data in reports or public issues.

## Read-Only by Default

The server exposes read-only tools unless the operator enables `--read-write` or `SQUARESPACE_MCP_READ_ONLY=false`. Give the Squarespace credential only the permissions needed for the deployment.

## Credential Handling

### Local Stdio Mode

The process reads `SQUARESPACE_API_KEY` or `SQUARESPACE_ACCESS_TOKEN` from its environment and sends it to Squarespace for API requests. Protect any client configuration file or secret store used to supply that environment variable.

### OAuth HTTP Mode (`AUTHMODE=oauth`)

- Each user submits their own Squarespace credential to the hosted consent page. The server validates it directly with Squarespace and encrypts it into OAuth tokens using AES-256-GCM and `MCP_TOKEN_SECRET`.
- The application does not write these credentials to a database. They are present in process memory while used and inside encrypted tokens retained by the client. Where a client persists its tokens depends on that client's configuration.
- Every `/mcp` request requires a valid bearer token. One user's authorization does not unlock the endpoint for anonymous callers or other users.
- Access tokens expire after one hour. Refresh tokens expire after 30 days and are replaced on refresh; active sessions can therefore last longer than 30 days.
- Bearer tokens are not bound to a particular machine. Anyone who obtains a valid token can use it until it expires or is invalidated.
- Authorization codes expire after three minutes and use PKCE. The consent form submits only to the same origin. A completion page then navigates to the registered callback, with a manual continuation link and a nonce-protected script.

Existing deployments that set `MCP_TOKEN_SECRET` without `AUTHMODE` keep using OAuth mode.

### API-Key HTTP Modes

The inbound MCP key and the outbound Squarespace credential are separate:

- `insecure-env` compares the caller's bearer token with `MCPAPIKEY` in constant time.
- `secure-sqlite` stores bcrypt hashes of MCP keys in SQLite and records successful-use timestamps. `INITAPIKEY` creates the initial admin key only when the database is first created.
- Both modes use the server's `SQUARESPACE_API_KEY` or `SQUARESPACE_ACCESS_TOKEN` for outbound requests. All authorized MCP callers therefore access the same configured store, subject to the server's read-only setting and the Squarespace credential's permissions.
- These modes do not expose browser OAuth login. A client must support supplying a bearer key.
- Protect the SQLite database and its backups. Cloud Run's local filesystem is ephemeral and is not durable key storage.

The separate `OAuthSessionStore` helper encrypts stored access and refresh tokens with AES-256-GCM using a key derived from `MASTERENCRYPTIONKEY`. The HTTP routes do not currently use this helper, so setting that variable does not enable a stored Squarespace OAuth session flow.

## OAuth Replay and Revocation Limits

Consumed authorization codes, consumed refresh tokens, and revoked-token state are kept in process memory. They are not shared between instances and do not survive process restarts. Refresh-token exchange also does not currently consult the revoked-token map.

A single-instance setting reduces concurrent copies but does not make this state durable or guarantee only one process during a rollout. Use a durable authorization and revocation service before treating this as a public multi-tenant service.

## Emergency Revocation

Revoke a compromised Squarespace credential in Squarespace to stop its API access.

To invalidate all OAuth tokens issued by this deployment, generate a new `MCP_TOKEN_SECRET` version and deploy a new revision that references it. **Adding a Secret Manager version alone does not change running processes.** Route traffic to the new revision and retire old revisions, including any tagged URLs that still serve the old secret. Existing clients must register and authenticate again. See the [Cloud Run guide](docs/CLOUD_RUN.md#rotating-the-oauth-secret) for commands.

For API-key modes, replace `MCPAPIKEY` and restart the service, or remove the compromised key from the SQLite database. Changing `MCP_TOKEN_SECRET` does not revoke API-key-mode access.

## Logs and Operational Access

The application redacts credentials from Squarespace error details and does not intentionally log API keys or plaintext tokens. Do not add request-body or authorization-header logging. Restrict access to deployment configuration, secrets, logs, and database backups.
