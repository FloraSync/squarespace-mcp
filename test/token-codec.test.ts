import { describe, expect, it } from 'vitest';

import { EncryptedClientStore } from '../src/auth/client-store.js';
import { epochSeconds, InvalidSealedTokenError, TokenCodec } from '../src/auth/token-codec.js';

describe('encrypted OAuth token codec', () => {
  it('round-trips authenticated payloads without revealing their contents', () => {
    const codec = new TokenCodec('a'.repeat(32));
    const token = codec.seal({
      type: 'access',
      iat: epochSeconds(),
      exp: epochSeconds() + 60,
      jti: 'id',
      credential: 'squarespace-secret',
    });
    expect(token).not.toContain('squarespace-secret');
    expect(codec.open(token, 'access')).toMatchObject({ credential: 'squarespace-secret' });
  });

  it('rejects tampering, expiration, and unexpected token types', () => {
    const codec = new TokenCodec('b'.repeat(32));
    const expired = codec.seal({ type: 'access', iat: 1, exp: 2, jti: 'expired' });
    expect(() => codec.open(expired, 'access')).toThrowError(InvalidSealedTokenError);
    const token = codec.seal({ type: 'client', iat: epochSeconds(), exp: epochSeconds() + 60, jti: 'id' });
    const parts = token.split('.');
    parts[2] = `${parts[2]?.startsWith('a') ? 'b' : 'a'}${parts[2]?.slice(1)}`;
    expect(() => codec.open(parts.join('.'), 'client')).toThrowError(InvalidSealedTokenError);
    expect(() => codec.open(token, 'access')).toThrowError(InvalidSealedTokenError);
  });

  it('requires a strong deployment secret', () => {
    expect(() => new TokenCodec('short')).toThrow(/at least 32/);
  });
});

describe('encrypted dynamic client store', () => {
  it('recovers client metadata from a self-contained client id', async () => {
    const store = new EncryptedClientStore(new TokenCodec('c'.repeat(32)));
    const registered = await store.registerClient({
      redirect_uris: ['https://example.com/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      client_name: 'Test client',
    });
    await expect(store.getClient(registered.client_id)).resolves.toEqual(registered);
    await expect(store.getClient('not-a-client')).resolves.toBeUndefined();
  });
});
