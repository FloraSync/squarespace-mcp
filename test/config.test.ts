import { describe, expect, it } from 'vitest';

import { parseConfig } from '../src/config.js';

describe('CLI configuration', () => {
  it('defaults local execution to read-only stdio', () => {
    expect(parseConfig([], { SQUARESPACE_API_KEY: 'secret' })).toMatchObject({
      action: 'run',
      transport: 'stdio',
      credential: 'secret',
      readOnly: true,
    });
  });

  it('requires an explicit credential for stdio', () => {
    expect(() => parseConfig([], {})).toThrow(/SQUARESPACE_API_KEY/);
  });

  it('accepts an OAuth access token and the environment read-write opt-in', () => {
    expect(
      parseConfig([], { SQUARESPACE_ACCESS_TOKEN: 'oauth-token', SQUARESPACE_MCP_READ_ONLY: 'false' }),
    ).toMatchObject({ transport: 'stdio', credential: 'oauth-token', readOnly: false });
  });

  it('supports read-write HTTP configuration', () => {
    expect(
      parseConfig(['--http', '--read-write', '--port', '8080'], {
        MCP_TOKEN_SECRET: 'x'.repeat(32),
        MCP_PUBLIC_URL: 'https://mcp.example.com/mcp',
      }),
    ).toMatchObject({
      transport: 'http',
      port: 8080,
      readOnly: false,
      publicUrl: 'https://mcp.example.com/mcp',
    });
  });

  it('requires a token secret and validates the port in HTTP mode', () => {
    expect(() => parseConfig(['--http'], {})).toThrow(/MCP_TOKEN_SECRET/);
    expect(() => parseConfig(['--http', '--port', '70000'], { MCP_TOKEN_SECRET: 'x'.repeat(32) })).toThrow(
      /Invalid port/,
    );
  });

  it('handles help and version without credentials', () => {
    expect(parseConfig(['--help'], {})).toEqual({ action: 'help' });
    expect(parseConfig(['--version'], {})).toEqual({ action: 'version' });
  });
});
