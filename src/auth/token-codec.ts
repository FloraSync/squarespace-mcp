import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const TOKEN_PREFIX = 'fsmcp1';
const ASSOCIATED_DATA = Buffer.from('@florasync/squarespace-mcp/token/v1');

export type TokenPayload = {
  type: string;
  exp: number;
  iat: number;
  jti: string;
  [key: string]: unknown;
};

export class InvalidSealedTokenError extends Error {}

export class TokenCodec {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 32) {
      throw new Error('MCP_TOKEN_SECRET must contain at least 32 characters.');
    }
    this.key = createHash('sha256').update(secret, 'utf8').digest();
  }

  seal(payload: TokenPayload): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(ASSOCIATED_DATA);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      TOKEN_PREFIX,
      nonce.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  open<T extends TokenPayload>(token: string, expectedType?: string): T {
    try {
      const [prefix, noncePart, ciphertextPart, tagPart, extra] = token.split('.');
      if (prefix !== TOKEN_PREFIX || !noncePart || !ciphertextPart || !tagPart || extra) {
        throw new Error('Malformed token');
      }
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(noncePart, 'base64url'));
      decipher.setAAD(ASSOCIATED_DATA);
      decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
      const payload = JSON.parse(plaintext) as T;
      if (
        !payload ||
        typeof payload !== 'object' ||
        typeof payload.exp !== 'number' ||
        typeof payload.type !== 'string'
      ) {
        throw new Error('Invalid payload');
      }
      if (payload.exp <= epochSeconds()) throw new Error('Expired token');
      if (expectedType && payload.type !== expectedType) throw new Error('Unexpected token type');
      return payload;
    } catch (error) {
      throw new InvalidSealedTokenError(error instanceof Error ? error.message : 'Invalid token');
    }
  }
}

export function epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
