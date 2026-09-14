# 🛍️ Squarespace MCP

[![CI](https://github.com/FloraSync/squarespace-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/FloraSync/squarespace-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@florasync/squarespace-mcp.svg)](https://www.npmjs.com/package/@florasync/squarespace-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

**Connect your Squarespace store directly to your favorite AI assistants.**

Whether you use **Claude Desktop**, **Cursor**, **Gemini CLI**, or **Gemini Spark**, Squarespace MCP gives your AI the context it needs to answer questions about your store, analyze sales, check stock levels, and manage your catalog—all through simple, natural conversation.

---

### ✨ What can you ask your AI?

Once connected, you can ask questions and give instructions in plain English:

- 📦 **Inventory & Stock**: _"Which product variants are running low on stock?"_ or _"Do we have any out-of-stock items right now?"_
- 🛍️ **Orders & Fulfillment**: _"Show me all pending orders from this past weekend"_ or _"Check the status of order #10042."_
- 🏷️ **Discounts & Sales**: _"What discount codes are currently active?"_ or _(with write access)_ _"Create a 15% off discount code 'SPRING15' valid until Friday."_
- 👥 **Customers & Contacts**: _"Look up customer details for alex@example.com"_ or _"Find our top 10 customers by total spend."_
- 📈 **Store Performance**: _"Summarize transaction volume and sales for this past month."_

> 🛡️ **Safe by Default**: Squarespace MCP starts in **100% read-only mode**. Your AI can look up orders, inventory, and analytics, but it **cannot modify or delete anything** in your store unless you explicitly enable write mode. Your API keys are never logged or stored in any database.

---

## 🚀 Quick Start (Choose Your Setup)

Getting started takes less than 3 minutes. Pick how you prefer to use AI:

| If you use...          | Recommended Setup                       | How it works                                    |
| :--------------------- | :-------------------------------------- | :---------------------------------------------- |
| **Claude Desktop**     | [Claude Desktop Setup](#claude-desktop) | Runs locally on your computer with `npx`        |
| **Cursor / VS Code**   | [Cursor & IDE Setup](#cursor-setup)     | Runs locally on your computer with `npx`        |
| **Gemini CLI**         | [Gemini CLI Setup](#gemini-cli)         | Runs locally on your computer with `npx`        |
| **Gemini Spark** (Web) | [Gemini Spark Setup](#gemini-spark)     | Connects via a hosted HTTPS endpoint with OAuth |

---

### 🔑 Step 1: Get Your Squarespace API Key

To let your AI interact with your store, create a secure API key:

1. Log in to your [Squarespace Dashboard](https://account.squarespace.com).
2. Navigate to **Settings** → **Developer Tools** (or **Advanced**) → **Developer API Keys**.
3. Click **Generate Key**.
4. Name your key (e.g., `Squarespace MCP AI`).
5. Choose your permissions:
   - **Recommended for general use (Read-Only)**: Check **Read** for _Products_, _Inventory_, _Orders_, and _Profiles / Contacts_.
   - **If you plan to use write actions later**: Check **Read and Write** for the specific areas you want your AI to manage.
6. Click **Generate Key** and copy the key immediately _(Squarespace will only show it once)_.

> [!NOTE]
> Squarespace Developer API Keys are available on plans that support custom commerce integrations (typically Commerce Advanced). Learn more in the [Squarespace Authentication Guide](https://developers.squarespace.com/commerce-apis/authentication-and-permissions).

---

### 💻 Local Desktop Setup (Claude, Cursor, Gemini CLI)

Local setups run directly on your computer. You only need **Node.js 20 or newer** installed.

<a id="claude-desktop"></a>

#### 🟣 Claude Desktop

Add this configuration to your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "squarespace": {
      "command": "npx",
      "args": ["-y", "@florasync/squarespace-mcp@0.1.0"],
      "env": {
        "SQUARESPACE_API_KEY": "YOUR_SQUARESPACE_API_KEY_HERE"
      }
    }
  }
}
```

Restart Claude Desktop, and you'll see a hammer icon 🔨 with Squarespace tools ready to use!

---

<a id="gemini-cli"></a>

#### 🔵 Gemini CLI / Antigravity CLI

Add this to `~/.gemini/settings.json` or your project's `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "squarespace": {
      "command": "npx",
      "args": ["-y", "@florasync/squarespace-mcp@0.1.0"],
      "env": {
        "SQUARESPACE_API_KEY": "YOUR_SQUARESPACE_API_KEY_HERE"
      },
      "timeout": 30000,
      "trust": false
    }
  }
}
```

---

<a id="cursor-setup"></a>

#### 🟢 Cursor & IDE Setup

In Cursor, open **Settings** → **Features** → **MCP Servers** → **Add New MCP Server**:

- **Name**: `squarespace`
- **Type**: `command`
- **Command**: `npx -y @florasync/squarespace-mcp@0.1.0`
- **Environment Variables**: `SQUARESPACE_API_KEY=YOUR_SQUARESPACE_API_KEY_HERE`

Or create `.cursor/mcp.json` in your workspace:

```json
{
  "mcpServers": {
    "squarespace": {
      "command": "npx",
      "args": ["-y", "@florasync/squarespace-mcp@0.1.0"],
      "env": {
        "SQUARESPACE_API_KEY": "YOUR_SQUARESPACE_API_KEY_HERE"
      }
    }
  }
}
```

---

#### ⚡ Quick Command-Line Test

You can also run the server directly in your terminal to verify your connection:

```bash
SQUARESPACE_API_KEY="your-squarespace-api-key" \
  npx -y @florasync/squarespace-mcp@0.1.0
```

---

<a id="gemini-spark"></a>

### 🌐 Gemini Spark (Web App)

Because [Gemini Spark](https://support.google.com/gemini/answer/17209137) runs in Google's cloud web app, it cannot run `npx` commands on your computer. Instead, it connects via an **HTTPS endpoint** using standard OAuth 2.1 and encrypted credential tokens.

```text
Local MCP Client (Claude, Cursor) ──stdio──> npx @florasync/squarespace-mcp ──Bearer──> Squarespace API

Gemini Spark (Google Web App)     ──HTTPS──> Hosted Cloud Run Service       ──Bearer──> Squarespace API
                                                      │
                                                      └─ User enters Squarespace key on secure web login
```

#### How to connect Gemini Spark:

1. **Deploy the container** to Google Cloud Run (takes ~3 minutes, free or pennies/month). Follow our step-by-step [Google Cloud Run Deployment Guide](docs/CLOUD_RUN.md).
2. In the Gemini web app, go to **Settings & help** → **Connected Apps**.
3. Under **Custom apps for Spark**, enter your deployed URL (e.g. `https://your-service.run.app/mcp`).
4. Spark automatically connects and opens a secure authorization page.
5. Paste your Squarespace API key. The server validates your key directly with Squarespace and you're ready to chat!

---

## ✍️ Enabling Write Mode (Optional)

By default, the server runs in **safe read-only mode**. If you'd like your AI to perform actions like adjusting inventory, creating discounts, or updating products:

- **In CLI / npx**: Add `--read-write` to the command arguments:
  ```bash
  SQUARESPACE_API_KEY="your-key" npx -y @florasync/squarespace-mcp@0.1.0 --read-write
  ```
- **In client JSON configs**: Add `"--read-write"` to the `"args"` array:
  ```json
  "args": ["-y", "@florasync/squarespace-mcp@0.1.0", "--read-write"]
  ```
- **In Cloud Run / Remote deployments**: Set the environment variable:
  ```env
  SQUARESPACE_MCP_READ_ONLY=false
  ```

---

## 🧰 What It Supports (52 Operations)

Squarespace MCP provides **52 official operations** generated directly from Squarespace's Commerce OpenAPI specification (24 read-only, 28 write):

| Area                 | Capabilities                                                       | Read-Only Tools                                      | Write Tools (Requires `--read-write`)                  |
| :------------------- | :----------------------------------------------------------------- | :--------------------------------------------------- | :----------------------------------------------------- |
| **Products v2**      | Physical, service, and digital products, variants, images, sorting | Browse products, view variants, check image status   | Create/update/delete products, variants, and images    |
| **Inventory**        | Real-time stock counts and quantity tracking                       | Check stock levels, view variant quantities          | Add, subtract, or set stock levels                     |
| **Orders**           | Full order lifecycle management                                    | List recent orders, search orders, get order details | Import orders, fulfill orders with tracking info       |
| **Discounts**        | Promo codes and automated store discounts                          | List active discounts, inspect discount rules        | Create, update, or delete discount codes               |
| **Contacts**         | Customer directory and address books                               | Query contacts, search by email, view addresses      | Create, update, or remove customer contacts            |
| **Analytics**        | Customer purchase history and metrics                              | Fetch per-contact transaction summaries              | _(Read-only query)_                                    |
| **Transactions**     | Financial ledger and payment documents                             | Retrieve transaction documents and settlement info   | _(Read-only)_                                          |
| **Website Identity** | Site details and authenticated user profile                        | Inspect site metadata and member permissions         | _(Read-only)_                                          |
| **Profiles**         | Legacy customer profile records                                    | Read legacy profile data                             | _(Read-only)_                                          |
| **Webhooks**         | Real-time event notifications                                      | List active webhook subscriptions                    | Create, test, rotate secrets, and delete subscriptions |

> [!NOTE]
> **API Scope Boundary**: This server integrates with Squarespace's official _Commerce APIs_. Squarespace does not offer public APIs for editing general page layouts, blog posts, form blocks, or custom CSS, so those operations are not included.

---

## 🔒 Security & Privacy

We take the security of your store seriously:

- **Never logs credentials**: API keys and tokens are strictly scrubbed from logs and error messages.
- **No credential database**: The server never stores your API key on disk or in a database.
- **Process isolation**: In local mode, keys stay in your personal machine's environment.
- **Industry-standard encryption**: In remote/web mode, credentials and OAuth tokens are encrypted using **AES-256-GCM** with a secret key (`MCP_TOKEN_SECRET`) you control.
- **Client safety confirmations**: MCP clients (like Claude and Gemini CLI) prompt you before executing actions.

For complete details, please read our [Security Policy](SECURITY.md).

---

## ⚙️ Environment Variables & Options

### Command-Line Flags

| Flag                 | Description                                                | Default                       |
| :------------------- | :--------------------------------------------------------- | :---------------------------- |
| `--read-write`       | Enables tools that modify store data                       | `false` (Read-only)           |
| `--http`             | Starts the remote Streamable HTTP server instead of stdio  | `false`                       |
| `--port <number>`    | HTTP port to listen on                                     | `3000` (or `$PORT`)           |
| `--host <string>`    | HTTP host to bind                                          | `0.0.0.0` (or `$HOST`)        |
| `--public-url <url>` | Public HTTPS endpoint ending in `/mcp` for OAuth discovery | `http://localhost:<port>/mcp` |
| `-v, --version`      | Display version number                                     |                               |
| `-h, --help`         | Display help screen                                        |                               |

### Environment Variables

| Variable                    | Transport     | Required?  | Purpose                                                                           |
| :-------------------------- | :------------ | :--------- | :-------------------------------------------------------------------------------- |
| `SQUARESPACE_API_KEY`       | Local / Stdio | Yes*       | Your Squarespace Developer API Key (*or use `SQUARESPACE_ACCESS_TOKEN` for OAuth) |
| `SQUARESPACE_ACCESS_TOKEN`  | Local / Stdio | Optional   | Squarespace OAuth Bearer Token (required for webhook operations)                  |
| `SQUARESPACE_MCP_READ_ONLY` | Both          | Optional   | Set to `false` to enable write tools (defaults to `true`)                         |
| `MCP_PUBLIC_URL`            | Remote HTTP   | Yes (HTTP) | Public HTTPS endpoint ending in `/mcp` used by OAuth discovery                    |
| `MCP_TOKEN_SECRET`          | Remote HTTP   | Yes (HTTP) | At least 32 characters; used to encrypt OAuth tokens with AES-256-GCM             |
| `PORT`                      | Remote HTTP   | Optional   | Port to listen on (defaults to `3000`)                                            |

---

## 🛠️ Development & Contributing

Contributions and feedback are very welcome!

### Local Development Setup

```bash
# Clone the repository
git clone https://github.com/FloraSync/squarespace-mcp.git
cd squarespace-mcp

# Install dependencies
npm ci

# Run quality checks
npm run typecheck       # TypeScript verification
npm run lint            # ESLint
npm run format:check    # Prettier style check
npm test                # Vitest test suite
npm run test:coverage   # Full coverage report
npm run build           # Compile to dist/
```

### Keeping in Sync with Squarespace

When Squarespace updates their official Commerce API schema:

```bash
# Automatically fetches the latest official OpenAPI schema and regenerates tool definitions
npm run sync:api
npm test
```

---

## 🏷️ Releases

Releases are published automatically to npm with cryptographic provenance upon tagging:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Prebuilt multi-arch Docker images are published to GitHub Container Registry:

```bash
docker pull ghcr.io/florasync/squarespace-mcp:0.1.0
```

---

## 📚 Resources & Links

- [Google Cloud Run Deployment Guide](docs/CLOUD_RUN.md)
- [Security Policy](SECURITY.md)
- [Squarespace Commerce API Documentation](https://developers.squarespace.com/commerce-apis/overview)
- [Squarespace Developer API Keys Guide](https://developers.squarespace.com/commerce-apis/authentication-and-permissions)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Gemini Connected Apps Documentation](https://support.google.com/gemini/answer/17209137)

---

## 📜 License & Legal

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

_Disclaimer: Squarespace is a registered trademark of Squarespace, Inc. Gemini is a trademark of Google LLC. This open-source project is independently maintained by FloraSync and is not officially affiliated with or endorsed by Squarespace or Google._
