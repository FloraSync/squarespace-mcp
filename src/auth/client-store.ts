import { randomUUID } from 'node:crypto';

import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

import { epochSeconds, InvalidSealedTokenError, type TokenCodec, type TokenPayload } from './token-codec.js';

type ClientPayload = TokenPayload & {
  type: 'client';
  client: Omit<OAuthClientInformationFull, 'client_id'>;
};

export class EncryptedClientStore implements OAuthRegisteredClientsStore {
  constructor(private readonly codec: TokenCodec) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    try {
      const payload = this.codec.open<ClientPayload>(clientId, 'client');
      return { ...payload.client, client_id: clientId };
    } catch (error) {
      if (error instanceof InvalidSealedTokenError) return undefined;
      throw error;
    }
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
  ): Promise<OAuthClientInformationFull> {
    const issuedAt = epochSeconds();
    const clientWithoutId = { ...client, client_id_issued_at: issuedAt };
    const clientId = this.codec.seal({
      type: 'client',
      iat: issuedAt,
      exp: issuedAt + 365 * 24 * 60 * 60,
      jti: randomUUID(),
      client: clientWithoutId,
    });
    return { ...clientWithoutId, client_id: clientId };
  }
}
