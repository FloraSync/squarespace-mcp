# Security policy

## Supported versions

Security fixes are released for the latest published version.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not include Squarespace API keys, OAuth tokens, MCP access tokens, customer data, or order data in an issue.

## Credential handling

- Local stdio mode reads the Squarespace credential from the process environment.
- In `insecure-env` HTTP mode, the server compares the bearer token to `MCPAPIKEY` in constant time.
- In `secure-sqlite` HTTP mode, API keys are bcrypt-hashed in SQLite and successful uses update their audit timestamp.
- Squarespace OAuth access and refresh tokens are encrypted with AES-256-GCM before they are stored in SQLite.
- The server never logs credentials or plaintext API keys. Remote deployments must protect the `/data` volume and use a strong `MASTERENCRYPTIONKEY`.
- Read-only mode is the default. Enable write tools only on deployments that need them.
