import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ApiKeyStore,
  OAuthSessionStore,
  SecretCodec,
  apiKeyId,
  constantTimeEqual,
  createInsecureVerifier,
  openApiKeyStore,
} from '../src/auth/api-key-store.js';

describe('MCP API-key authentication', () => {
  const databases: Array<ApiKeyStore | DatabaseSync> = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('compares insecure environment keys safely, including unequal lengths', () => {
    const verify = createInsecureVerifier('developer-api-key');
    expect(verify('developer-api-key')).toBe(true);
    expect(verify('wrong')).toBe(false);
    expect(constantTimeEqual('short', 'a much longer key')).toBe(false);
  });

  it('stores only a bcrypt hash and audits successful use', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const store = new ApiKeyStore(database);
    const token = 'sklive-test-id.test-secret';
    const created = store.createApiKey('farm admin', token);
    expect(created.id).toBe('sklive-test-id');

    const row = database.prepare('SELECT keyhash, lastusedat FROM apikeys WHERE id = ?').get(created.id) as {
      keyhash: string;
      lastusedat: string | null;
    };
    expect(row.keyhash).toMatch(/^\$2[aby]\$12\$/);
    expect(row.keyhash).not.toContain(token);
    await expect(store.verify('sklive-test-id.wrong-secret')).resolves.toBeUndefined();
    await expect(store.verify(token)).resolves.toMatchObject({ id: created.id, name: 'farm admin' });
    expect(
      (database.prepare('SELECT lastusedat FROM apikeys WHERE id = ?').get(created.id) as { lastusedat: string })
        .lastusedat,
    ).toBeTruthy();
  });

  it('bootstraps once and ignores INITAPIKEY on existing databases', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'squarespace-mcp-'));
    directories.push(directory);
    const path = join(directory, 'auth.db');
    const initial = openApiKeyStore({ databasePath: path, initApiKey: 'initial-key' });
    initial.close();

    const reopened = openApiKeyStore({
      databasePath: path,
      initApiKey: 'a-different-key',
    });
    databases.push(reopened);
    await expect(reopened.verify('initial-key')).resolves.toMatchObject({ name: 'admin' });
    await expect(reopened.verify('a-different-key')).resolves.toBeUndefined();
    expect(readFileSync(path)).not.toContain('initial-key');
  });
});

describe('encrypted OAuth session storage', () => {
  it('uses fresh AES-GCM IVs and persists decryptable tokens', () => {
    const database = new DatabaseSync(':memory:');
    const store = new ApiKeyStore(database);
    const sessions = new OAuthSessionStore(store, 'b'.repeat(32));
    const codec = new SecretCodec('b'.repeat(32));
    const first = codec.encrypt('access-token');
    const second = codec.encrypt('access-token');
    expect(first).not.toBe(second);
    expect(codec.decrypt(first)).toBe('access-token');
    expect(first).not.toContain('access-token');

    sessions.save({
      siteid: 'site-1',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_900_000_000,
    });
    expect(sessions.get('site-1')).toMatchObject({
      siteid: 'site-1',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_900_000_000,
    });

    const encoded = Buffer.from(first, 'base64');
    const lastByte = encoded.at(-1);
    if (lastByte === undefined) throw new Error('Encrypted value was empty.');
    encoded[encoded.length - 1] = lastByte ^ 1;
    expect(() => codec.decrypt(encoded.toString('base64'))).toThrow(/decrypt/);
    database.close();
  });

  it('derives stable IDs for raw bootstrap keys', () => {
    // Dotless tokens use an HMAC-derived ID so attackers cannot force a bcrypt
    // comparison by sending arbitrary dotless bearer values to the /mcp endpoint.
    expect(apiKeyId('raw-bootstrap-key')).toBe('5ee3a3d3c7b51ebead5b0c040a775ef2');
    expect(apiKeyId('sklive123.secret')).toBe('sklive123');
  });
});
