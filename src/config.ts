import { parseArgs } from 'node:util';

import type { AuthMode } from './auth/api-key-store.js';

export type CliConfig =
  | { action: 'help' }
  | { action: 'version' }
  | {
      action: 'run';
      transport: 'stdio';
      credential: string;
      readOnly: boolean;
      apiBaseUrl?: string;
    }
  | {
      action: 'run';
      transport: 'http';
      authMode: AuthMode;
      publicUrl: string;
      tokenSecret?: string;
      mcpApiKey?: string;
      databasePath: string;
      initApiKey?: string;
      masterEncryptionKey?: string;
      credential?: string;
      host: string;
      port: number;
      readOnly: boolean;
      apiBaseUrl?: string;
    };

export function parseConfig(argv: string[], environment: NodeJS.ProcessEnv): CliConfig {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      http: { type: 'boolean', default: false },
      host: { type: 'string' },
      port: { type: 'string' },
      'public-url': { type: 'string' },
      'read-write': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  if (values.help) return { action: 'help' };
  if (values.version) return { action: 'version' };

  const readOnly = values['read-write'] ? false : parseReadOnly(environment.SQUARESPACE_MCP_READ_ONLY);
  const apiBaseUrl = environment.SQUARESPACE_API_BASE_URL;

  if (values.http) {
    const tokenSecret = environment.MCP_TOKEN_SECRET;
    const authMode = parseAuthMode(environment.AUTHMODE, tokenSecret);
    const port = parsePort(values.port ?? environment.PORT ?? '3000');
    const publicUrl = values['public-url'] ?? environment.MCP_PUBLIC_URL ?? `http://localhost:${port}/mcp`;
    const mcpApiKey = environment.MCPAPIKEY;
    const credential = environment.SQUARESPACE_API_KEY ?? environment.SQUARESPACE_ACCESS_TOKEN;
    if (authMode === 'oauth' && !tokenSecret) {
      throw new Error('MCP_TOKEN_SECRET is required for OAuth HTTP mode. Generate one with: openssl rand -base64 32');
    }
    if (authMode === 'insecure-env' && !mcpApiKey) {
      throw new Error('MCPAPIKEY is required for insecure-env HTTP mode.');
    }
    if (authMode === 'secure-sqlite' && !credential) {
      throw new Error('SQUARESPACE_API_KEY is required for secure-sqlite HTTP mode.');
    }
    return {
      action: 'run',
      transport: 'http',
      authMode,
      publicUrl,
      tokenSecret,
      mcpApiKey,
      databasePath: environment.SQLITEDBPATH ?? '/data/squarespace-mcp.sqlite',
      initApiKey: environment.INITAPIKEY,
      masterEncryptionKey: environment.MASTERENCRYPTIONKEY,
      credential,
      host: values.host ?? environment.HOST ?? '0.0.0.0',
      port,
      readOnly,
      apiBaseUrl,
    };
  }

  const credential = environment.SQUARESPACE_API_KEY ?? environment.SQUARESPACE_ACCESS_TOKEN;
  if (!credential) {
    throw new Error('Set SQUARESPACE_API_KEY (or SQUARESPACE_ACCESS_TOKEN) before starting the stdio server.');
  }
  return { action: 'run', transport: 'stdio', credential, readOnly, apiBaseUrl };
}

function parseAuthMode(value: string | undefined, tokenSecret: string | undefined): AuthMode {
  // Preserve existing OAuth deployments that only configure MCP_TOKEN_SECRET.
  if (value === undefined || value === '') return tokenSecret ? 'oauth' : 'insecure-env';
  if (value === 'oauth' || value === 'insecure-env' || value === 'secure-sqlite') return value;
  throw new Error(`AUTHMODE must be oauth, insecure-env, or secure-sqlite, not ${value}.`);
}

function parseReadOnly(value: string | undefined): boolean {
  if (value === undefined) return true;
  return !['0', 'false', 'no'].includes(value.toLowerCase());
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid port: ${value}`);
  return port;
}
