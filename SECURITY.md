# Security policy

## Supported versions

Security fixes are released for the latest published version.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not include Squarespace API keys, OAuth tokens, MCP access tokens, customer data, or order data in an issue.

## Credential handling

- Local stdio mode reads the Squarespace credential from the process environment.
- Remote mode receives the credential through the authorization form over HTTPS, validates it directly with Squarespace, and embeds it only inside authenticated AES-256-GCM tokens.
- The server never logs credentials and has no credential database.
- Remote deployments must set a strong, stable `MCP_TOKEN_SECRET`. Rotating it invalidates all issued MCP tokens and client registrations.
- Read-only mode is the default. Enable write tools only on deployments that need them.
