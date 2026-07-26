import { parseArgs } from 'node:util';

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
      publicUrl: string;
      tokenSecret: string;
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
    const port = parsePort(values.port ?? environment.PORT ?? '3000');
    const publicUrl = values['public-url'] ?? environment.MCP_PUBLIC_URL ?? `http://localhost:${port}/mcp`;
    const tokenSecret = environment.MCP_TOKEN_SECRET;
    if (!tokenSecret) {
      throw new Error('MCP_TOKEN_SECRET is required in HTTP mode. Generate one with: openssl rand -base64 32');
    }
    return {
      action: 'run',
      transport: 'http',
      publicUrl,
      tokenSecret,
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

function parseReadOnly(value: string | undefined): boolean {
  if (value === undefined) return true;
  return !['0', 'false', 'no'].includes(value.toLowerCase());
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid port: ${value}`);
  return port;
}
