#!/usr/bin/env node

import { parseConfig } from './config.js';
import { startHttpTransport } from './transports/http.js';
import { startStdioTransport } from './transports/stdio.js';
import { PACKAGE_VERSION } from './version.js';

const HELP = `Squarespace MCP

Usage:
  squarespace-mcp                 Run a local stdio server
  squarespace-mcp --http          Run a remote Streamable HTTP server

Options:
  --http                          Use Streamable HTTP instead of stdio
  --host <host>                   HTTP bind host (default: 0.0.0.0)
  --port <port>                   HTTP port (default: PORT or 3000)
  --public-url <https://.../mcp>  Public MCP URL used by OAuth discovery
  --read-write                    Enable tools that modify Squarespace data
  -h, --help                      Show help
  -v, --version                   Show version

Stdio environment:
  SQUARESPACE_API_KEY             Squarespace API key
  SQUARESPACE_ACCESS_TOKEN        Squarespace OAuth token (alternative)

HTTP environment:
  AUTHMODE                        oauth, insecure-env, or secure-sqlite
                                  Default: oauth with MCP_TOKEN_SECRET; otherwise insecure-env
  MCP_TOKEN_SECRET                32+ character secret for OAuth HTTP mode
  MCPAPIKEY                       Inbound bearer key for insecure-env HTTP mode
  SQUARESPACE_API_KEY             Outbound credential for API-key HTTP modes
  SQLITEDBPATH                    SQLite path for secure-sqlite (default: /data/squarespace-mcp.sqlite)
  INITAPIKEY                      Initial secure-sqlite admin key (first boot only)
  MASTERENCRYPTIONKEY             Root key for secure-sqlite encrypted OAuth tokens
  MCP_PUBLIC_URL                  Public HTTPS URL ending in /mcp
`;

try {
  const config = parseConfig(process.argv.slice(2), process.env);
  if (config.action === 'help') {
    process.stdout.write(HELP);
  } else if (config.action === 'version') {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
  } else if (config.transport === 'stdio') {
    await startStdioTransport(config);
  } else {
    const server = await startHttpTransport(config);
    process.stderr.write(
      `Squarespace MCP ${PACKAGE_VERSION} listening on ${config.host}:${config.port} (${config.readOnly ? 'read-only' : 'read-write'})\n`,
    );
    const shutdown = () => server.close(() => process.exit(0));
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
