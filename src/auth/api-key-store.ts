import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import bcrypt from 'bcryptjs';
import { DatabaseSync } from 'node:sqlite';

export type AuthMode = 'insecure-env' | 'secure-sqlite';

export type ApiKeyRecord = {
  id: string;
  name: string;
  createdat: string;
  lastusedat: string | null;
};

export type OAuthSession = {
  siteid: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  updatedAt?: string;
};

const BCRYPT_ROUNDS = 10;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS apikeys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keyhash TEXT NOT NULL,
  createdat DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastusedat DATETIME
);

CREATE TABLE IF NOT EXISTS oauthsessions (
  siteid TEXT PRIMARY KEY,
  encryptedaccesstoken TEXT NOT NULL,
  encryptedrefreshtoken TEXT NOT NULL,
  expiresat DATETIME NOT NULL,
  updatedat DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

export class ApiKeyStore {
  private readonly db: DatabaseSync;
  private readonly ownsDatabase: boolean;

  constructor(database: DatabaseSync | string) {
    this.ownsDatabase = typeof database === 'string';
    this.db = typeof database === 'string' ? new DatabaseSync(database) : database;
    this.db.exec(AUTH_SCHEMA);
  }

  get database(): DatabaseSync {
    return this.db;
  }

  async verify(token: string): Promise<ApiKeyRecord | undefined> {
    const id = apiKeyId(token);
    const row = this.db.prepare('SELECT id, name, keyhash, createdat, lastusedat FROM apikeys WHERE id = ?').get(id) as
      (ApiKeyRecord & { keyhash: string }) | undefined;
    if (!row || !(await bcrypt.compare(token, row.keyhash))) return undefined;
    this.db.prepare('UPDATE apikeys SET lastusedat = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    const audited = this.db.prepare('SELECT lastusedat FROM apikeys WHERE id = ?').get(id) as
      | { lastusedat: string | null }
      | undefined;
    return { id: row.id, name: row.name, createdat: row.createdat, lastusedat: audited?.lastusedat ?? row.lastusedat };
  }

  createApiKey(name: string, token = generateApiKey()): { id: string; name: string; token: string } {
    const id = apiKeyId(token);
    const keyhash = bcrypt.hashSync(token, BCRYPT_ROUNDS);
    this.db.prepare('INSERT INTO apikeys (id, name, keyhash) VALUES (?, ?, ?)').run(id, name, keyhash);
    return { id, name, token };
  }

  close(): void {
    if (this.ownsDatabase) this.db.close();
  }
}

export class OAuthSessionStore {
  private readonly codec: SecretCodec;
  private readonly db: DatabaseSync;
  private readonly ownsDatabase: boolean;

  constructor(database: ApiKeyStore | DatabaseSync | string, masterEncryptionKey: string) {
    this.codec = new SecretCodec(masterEncryptionKey);
    this.ownsDatabase = typeof database === 'string';
    this.db =
      database instanceof ApiKeyStore
        ? database.database
        : typeof database === 'string'
          ? new DatabaseSync(database)
          : database;
    this.db.exec(AUTH_SCHEMA);
  }

  save(session: OAuthSession): void {
    const db = this.db;
    db.prepare(
      `INSERT INTO oauthsessions
        (siteid, encryptedaccesstoken, encryptedrefreshtoken, expiresat)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(siteid) DO UPDATE SET
         encryptedaccesstoken = excluded.encryptedaccesstoken,
         encryptedrefreshtoken = excluded.encryptedrefreshtoken,
         expiresat = excluded.expiresat,
         updatedat = CURRENT_TIMESTAMP`,
    ).run(
      session.siteid,
      this.codec.encrypt(session.accessToken),
      this.codec.encrypt(session.refreshToken),
      session.expiresAt,
    );
  }

  get(siteid: string): OAuthSession | undefined {
    const row = this.db
      .prepare(
        'SELECT siteid, encryptedaccesstoken, encryptedrefreshtoken, expiresat, updatedat FROM oauthsessions WHERE siteid = ?',
      )
      .get(siteid) as
      | {
          siteid: string;
          encryptedaccesstoken: string;
          encryptedrefreshtoken: string;
          expiresat: number;
          updatedat: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      siteid: row.siteid,
      accessToken: this.codec.decrypt(row.encryptedaccesstoken),
      refreshToken: this.codec.decrypt(row.encryptedrefreshtoken),
      expiresAt: row.expiresat,
      updatedAt: row.updatedat,
    };
  }

  close(): void {
    if (this.ownsDatabase) this.db.close();
  }
}

export class SecretCodec {
  private readonly key: Buffer;

  constructor(masterEncryptionKey: string) {
    if (masterEncryptionKey.length < 32) {
      throw new Error('MASTERENCRYPTIONKEY must contain at least 32 characters.');
    }
    this.key = createHash('sha256').update(masterEncryptionKey, 'utf8').digest();
  }

  encrypt(value: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }

  decrypt(value: string): string {
    try {
      const encoded = Buffer.from(value, 'base64');
      if (encoded.length < IV_BYTES + AUTH_TAG_BYTES) throw new Error('Malformed encrypted value.');
      const iv = encoded.subarray(0, IV_BYTES);
      const tag = encoded.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
      const ciphertext = encoded.subarray(IV_BYTES + AUTH_TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Unable to decrypt stored OAuth token.');
    }
  }
}

export function createInsecureVerifier(expected: string): (token: string) => boolean {
  return (token) => constantTimeEqual(token, expected);
}

export function apiKeyId(token: string): string {
  const separator = token.indexOf('.');
  if (separator > 0 && separator <= 128) return token.slice(0, separator);
  return `raw-${createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 32)}`;
}

export function generateApiKey(): string {
  return `sklive${randomBytes(8).toString('hex')}.${randomBytes(32).toString('base64url')}`;
}

export function openApiKeyStore(options: {
  databasePath: string;
  initApiKey?: string;
  masterEncryptionKey?: string;
}): ApiKeyStore {
  const existed = options.databasePath !== ':memory:' && existsSync(options.databasePath);
  if (existed && !options.masterEncryptionKey) {
    throw new Error('MASTERENCRYPTIONKEY is required when the SQLite database already exists.');
  }
  if (!existed && !options.initApiKey) {
    throw new Error('INITAPIKEY is required when initializing the SQLite database.');
  }
  if (options.databasePath !== ':memory:') {
    mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
  }
  const store = new ApiKeyStore(options.databasePath);
  try {
    if (!existed && options.initApiKey) store.createApiKey('admin', options.initApiKey);
    if (options.databasePath !== ':memory:') chmodSync(options.databasePath, 0o600);
  } catch (error) {
    store.close();
    throw error;
  }
  return store;
}

export function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  const length = Math.max(actualBytes.length, expectedBytes.length);
  const actualPadded = Buffer.alloc(length);
  const expectedPadded = Buffer.alloc(length);
  actualBytes.copy(actualPadded);
  expectedBytes.copy(expectedPadded);
  return timingSafeEqual(actualPadded, expectedPadded) && actualBytes.length === expectedBytes.length;
}
