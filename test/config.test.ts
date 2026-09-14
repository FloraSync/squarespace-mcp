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

  it('ignores HTTP authentication settings for stdio', () => {
    expect(parseConfig([], { AUTHMODE: 'unsupported', SQUARESPACE_API_KEY: 'secret' })).toMatchObject({
      transport: 'stdio',
      credential: 'secret',
    });
  });

  it('accepts an OAuth access token and the environment read-write opt-in', () => {
    expect(
      parseConfig([], { SQUARESPACE_ACCESS_TOKEN: 'oauth-token', SQUARESPACE_MCP_READ_ONLY: 'false' }),
    ).toMatchObject({ transport: 'stdio', credential: 'oauth-token', readOnly: false });
  });

  it('supports read-write insecure-env HTTP configuration', () => {
    expect(
      parseConfig(['--http', '--read-write', '--port', '8080'], {
        AUTHMODE: 'insecure-env',
        MCPAPIKEY: 'developer-key',
        MCP_PUBLIC_URL: 'https://mcp.example.com/mcp',
      }),
    ).toMatchObject({
      transport: 'http',
      authMode: 'insecure-env',
      port: 8080,
      readOnly: false,
      publicUrl: 'https://mcp.example.com/mcp',
    });
  });

  it('defaults to insecure-env without a token secret and validates the HTTP configuration', () => {
    expect(() => parseConfig(['--http'], {})).toThrow(/MCPAPIKEY/);
    expect(() => parseConfig(['--http', '--port', '70000'], { MCPAPIKEY: 'developer-key' })).toThrow(/Invalid port/);
    expect(() => parseConfig(['--http'], { AUTHMODE: 'unsupported', MCPAPIKEY: 'developer-key' })).toThrow(/AUTHMODE/);
  });

  it.each([undefined, '', 'oauth'])('preserves OAuth configuration with AUTHMODE=%s', (authMode) => {
    expect(
      parseConfig(['--http'], {
        AUTHMODE: authMode,
        MCP_TOKEN_SECRET: 'a'.repeat(32),
        MCP_PUBLIC_URL: 'https://mcp.example.com/mcp',
      }),
    ).toMatchObject({
      transport: 'http',
      authMode: 'oauth',
      tokenSecret: 'a'.repeat(32),
      readOnly: true,
      publicUrl: 'https://mcp.example.com/mcp',
    });
  });

  it('requires the encryption secret when OAuth is selected explicitly', () => {
    expect(() => parseConfig(['--http'], { AUTHMODE: 'oauth', MCPAPIKEY: 'developer-key' })).toThrow(
      /MCP_TOKEN_SECRET/,
    );
  });

  it.each(['insecure-env', 'secure-sqlite'])('honors explicit %s mode even with an OAuth secret', (authMode) => {
    expect(
      parseConfig(['--http'], {
        AUTHMODE: authMode,
        MCP_TOKEN_SECRET: 'a'.repeat(32),
        MCPAPIKEY: 'developer-key',
        SQUARESPACE_API_KEY: 'squarespace-key',
      }),
    ).toMatchObject({ transport: 'http', authMode });
  });

  it('supports secure-sqlite configuration without exposing bootstrap values', () => {
    expect(
      parseConfig(['--http'], {
        AUTHMODE: 'secure-sqlite',
        SQLITEDBPATH: '/tmp/florasync-auth.db',
        INITAPIKEY: 'initial-key',
        MASTERENCRYPTIONKEY: 'master-key',
        SQUARESPACE_API_KEY: 'squarespace-key',
      }),
    ).toMatchObject({
      transport: 'http',
      authMode: 'secure-sqlite',
      databasePath: '/tmp/florasync-auth.db',
      initApiKey: 'initial-key',
      masterEncryptionKey: 'master-key',
      credential: 'squarespace-key',
    });
  });

  it('requires an outbound credential for secure-sqlite HTTP mode', () => {
    expect(() => parseConfig(['--http'], { AUTHMODE: 'secure-sqlite', MCPAPIKEY: 'initial-key' })).toThrow(
      /SQUARESPACE_API_KEY/,
    );
  });

  it('handles help and version without credentials', () => {
    expect(parseConfig(['--help'], {})).toEqual({ action: 'help' });
    expect(parseConfig(['--version'], {})).toEqual({ action: 'version' });
  });
});
