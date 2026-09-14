# 🛡️ Security & Privacy Policy

At FloraSync, security and data privacy are foundational. **Squarespace MCP** is engineered so you can safely bring AI assistance to your e-commerce business without compromising sensitive customer data or store credentials.

---

## 🔒 Security Highlights at a Glance

- 🛡️ **Read-Only by Default**: The server starts in read-only mode. It cannot modify, adjust, or delete store data unless you explicitly enable write mode (`--read-write` or `SQUARESPACE_MCP_READ_ONLY=false`).
- 🚫 **Zero Credential Logging**: API keys, bearer tokens, and customer secrets are rigorously scrubbed and never written to standard output, server logs, or error responses.
- 💾 **No Credential Database**: We never store your Squarespace API keys or tokens in a database, disk file, or external service.
- 🔐 **AES-256-GCM Token Encryption**: In remote/web mode (Gemini Spark), session tokens are encrypted using authenticated 256-bit AES encryption.
- 🚨 **Instant Emergency Revocation**: Rotating your encryption key (`MCP_TOKEN_SECRET`) instantly invalidates all active sessions, registrations, and access tokens across the board.

---

## 💻 How Credentials Are Handled

### 1. Local Mode (Claude Desktop, Cursor, Gemini CLI)

When running locally on your computer:

- Your Squarespace API key stays completely on your local machine within the running process memory.
- No network requests are sent anywhere except directly between your machine and Squarespace's official API (`api.squarespace.com`).
- Once you close your AI assistant, the in-memory process terminates.

### 2. Remote Web Mode (Gemini Spark & Cloud Run)

When deployed to the cloud for web-based AI clients:

- **Direct Verification**: When you log in via the web consent screen, the server immediately validates your key directly with Squarespace.
- **Stateless Tokens**: Your credential is encrypted into short-lived, resource-bound OAuth tokens using **AES-256-GCM**.
- **Ephemeral Storage**: Keys live only in the encrypted tokens held by the authenticated client (e.g. Gemini Spark) and in-memory while executing requests.
- **Process Isolation**: No user credentials or customer order histories are saved to disk or persistent databases.

---

## 🔑 Best Practices for Squarespace API Keys

To keep your store safe, follow these best practices:

1. **Principle of Least Privilege**: When generating a Developer API Key in Squarespace:
   - If you only want your AI to answer questions (e.g. check inventory, list orders), select **Read** permissions only.
   - Only grant **Write** permissions for specific areas if you intend to have your AI manage catalog items or create discounts.
2. **One Key Per Tool**: Generate a dedicated API key specifically for Squarespace MCP (e.g. named `Squarespace MCP AI`). Do not reuse keys across different integrations.
3. **Easy Revocation**: If you ever suspect a key has been compromised or you stop using the integration, navigate to **Settings** → **Developer Tools** → **Developer API Keys** in Squarespace and click **Revoke**. The key will stop working immediately.

---

## 🚨 Emergency Token Revocation (Remote Cloud Mode)

If you have deployed Squarespace MCP to Google Cloud Run and need to immediately kick out all active sessions:

Rotate the `MCP_TOKEN_SECRET` in Google Secret Manager:

```bash
openssl rand -base64 32 | \
  gcloud secrets versions add squarespace-mcp-token-secret --data-file=-
```

Every existing OAuth token, session, and dynamic registration will immediately fail decryption and become unusable.

---

## 📢 Reporting a Vulnerability

We appreciate responsible security disclosures. If you believe you have found a security vulnerability in Squarespace MCP:

1. Please report it via **[GitHub Private Vulnerability Reporting](https://github.com/FloraSync/squarespace-mcp/security/advisories/new)**.
2. **Never include real API keys, tokens, or customer data** in bug reports, pull requests, or issue trackers.
3. We will review the report promptly and publish security fixes for the latest supported release.

---

## 📦 Supported Versions

Security updates are released for the latest published version on npm (`@florasync/squarespace-mcp`).
