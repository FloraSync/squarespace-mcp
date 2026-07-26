import { randomUUID } from 'node:crypto';

import {
  AccessDeniedError,
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Request, RequestHandler, Response } from 'express';

import { SquarespaceClient, type FetchImplementation } from '../squarespace/client.js';
import { USER_AGENT } from '../version.js';
import { EncryptedClientStore } from './client-store.js';
import { epochSeconds, InvalidSealedTokenError, type TokenCodec, type TokenPayload } from './token-codec.js';

const AUTHORIZATION_CODE_TTL_SECONDS = 3 * 60;
const PENDING_AUTHORIZATION_TTL_SECONDS = 10 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

type SerializableAuthorizationParams = {
  state?: string;
  scopes?: string[];
  codeChallenge: string;
  redirectUri: string;
  resource?: string;
};

type PendingPayload = TokenPayload & {
  type: 'pending';
  clientId: string;
  params: SerializableAuthorizationParams;
};

type CodePayload = TokenPayload & {
  type: 'code';
  clientId: string;
  credential: string;
  params: SerializableAuthorizationParams;
};

type CredentialTokenPayload = TokenPayload & {
  type: 'access' | 'refresh';
  clientId: string;
  credential: string;
  scopes: string[];
  resource?: string;
};

export type SquarespaceOAuthProviderOptions = {
  codec: TokenCodec;
  readOnly: boolean;
  apiBaseUrl?: string;
  fetchImplementation?: FetchImplementation;
};

export class SquarespaceOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: EncryptedClientStore;
  readonly approvalHandler: RequestHandler;
  private readonly consumedCodes = new Map<string, number>();
  private readonly consumedRefreshTokens = new Map<string, number>();
  private readonly revokedTokens = new Map<string, number>();

  constructor(private readonly options: SquarespaceOAuthProviderOptions) {
    this.clientsStore = new EncryptedClientStore(options.codec);
    this.approvalHandler = (request, response, next) => {
      void this.approve(request, response).catch(next);
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, response: Response): Promise<void> {
    assertRedirectUri(client, params.redirectUri);
    const now = epochSeconds();
    const pending = this.options.codec.seal({
      type: 'pending',
      iat: now,
      exp: now + PENDING_AUTHORIZATION_TTL_SECONDS,
      jti: randomUUID(),
      clientId: client.client_id,
      params: serializeParams(params),
    });
    sendAuthorizationPage(response, {
      pending,
      clientName: client.client_name ?? 'Gemini Spark',
      readOnly: this.options.readOnly,
    });
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const payload = this.openCode(authorizationCode);
    assertClient(payload.clientId, client.client_id);
    return payload.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.cleanupReplayState();
    const payload = this.openCode(authorizationCode);
    assertClient(payload.clientId, client.client_id);
    if (redirectUri && payload.params.redirectUri !== redirectUri)
      throw new InvalidGrantError('redirect_uri does not match.');
    assertResource(payload.params.resource, resource);
    if (this.consumedCodes.has(payload.jti)) throw new InvalidGrantError('Authorization code was already used.');
    this.consumedCodes.set(payload.jti, payload.exp);
    return this.issueTokens(payload.clientId, payload.credential, payload.params.scopes ?? [], payload.params.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.cleanupReplayState();
    const payload = this.openCredentialToken(refreshToken, 'refresh');
    assertClient(payload.clientId, client.client_id);
    assertResource(payload.resource, resource);
    if (this.consumedRefreshTokens.has(payload.jti)) throw new InvalidGrantError('Refresh token was already used.');
    const requestedScopes = scopes ?? payload.scopes;
    if (requestedScopes.some((scope) => !payload.scopes.includes(scope))) {
      throw new InvalidGrantError('Refresh token cannot be expanded to additional scopes.');
    }
    this.consumedRefreshTokens.set(payload.jti, payload.exp);
    return this.issueTokens(payload.clientId, payload.credential, requestedScopes, payload.resource);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    this.cleanupReplayState();
    const payload = this.openCredentialToken(token, 'access');
    if (this.revokedTokens.has(payload.jti)) throw new InvalidTokenError('Access token is revoked.');
    return {
      token,
      clientId: payload.clientId,
      scopes: payload.scopes,
      expiresAt: payload.exp,
      resource: payload.resource ? new URL(payload.resource) : undefined,
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    try {
      const payload = this.options.codec.open<CredentialTokenPayload>(request.token);
      if (payload.type === 'access' || payload.type === 'refresh') this.revokedTokens.set(payload.jti, payload.exp);
    } catch (error) {
      if (!(error instanceof InvalidSealedTokenError)) throw error;
    }
  }

  credentialFromAccessToken(token: string): string {
    return this.openCredentialToken(token, 'access').credential;
  }

  private async approve(request: Request, response: Response): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    const pendingToken = typeof request.body?.request === 'string' ? request.body.request : '';
    const credential = typeof request.body?.credential === 'string' ? request.body.credential.trim() : '';
    let pending: PendingPayload;
    try {
      pending = this.options.codec.open<PendingPayload>(pendingToken, 'pending');
    } catch {
      throw new AccessDeniedError('The authorization request expired. Start the connection again.');
    }

    const client = await this.clientsStore.getClient(pending.clientId);
    if (!client) throw new AccessDeniedError('The OAuth client registration is invalid or expired.');
    assertRedirectUri(client, pending.params.redirectUri);

    if (!credential) {
      sendAuthorizationPage(response, {
        pending: pendingToken,
        clientName: client.client_name ?? 'Gemini Spark',
        readOnly: this.options.readOnly,
        error: 'Enter a Squarespace API key or OAuth access token.',
      });
      return;
    }

    try {
      const squarespace = new SquarespaceClient({
        credential,
        userAgent: USER_AGENT,
        baseUrl: this.options.apiBaseUrl,
        fetchImplementation: this.options.fetchImplementation,
      });
      await squarespace.getWebsiteProfile();
    } catch {
      sendAuthorizationPage(response, {
        pending: pendingToken,
        clientName: client.client_name ?? 'Gemini Spark',
        readOnly: this.options.readOnly,
        error: 'Squarespace rejected that credential. Check the key and its API permissions.',
      });
      return;
    }

    const now = epochSeconds();
    const code = this.options.codec.seal({
      type: 'code',
      iat: now,
      exp: now + AUTHORIZATION_CODE_TTL_SECONDS,
      jti: randomUUID(),
      clientId: pending.clientId,
      credential,
      params: pending.params,
    });
    const redirect = new URL(pending.params.redirectUri);
    redirect.searchParams.set('code', code);
    if (pending.params.state) redirect.searchParams.set('state', pending.params.state);
    response.redirect(redirect.toString());
  }

  private issueTokens(clientId: string, credential: string, scopes: string[], resource?: string): OAuthTokens {
    const now = epochSeconds();
    const accessToken = this.options.codec.seal({
      type: 'access',
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_SECONDS,
      jti: randomUUID(),
      clientId,
      credential,
      scopes,
      resource,
    });
    const refreshToken = this.options.codec.seal({
      type: 'refresh',
      iat: now,
      exp: now + REFRESH_TOKEN_TTL_SECONDS,
      jti: randomUUID(),
      clientId,
      credential,
      scopes,
      resource,
    });
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    };
  }

  private openCode(token: string): CodePayload {
    try {
      return this.options.codec.open<CodePayload>(token, 'code');
    } catch {
      throw new InvalidGrantError('Authorization code is invalid or expired.');
    }
  }

  private openCredentialToken(token: string, type: 'access' | 'refresh'): CredentialTokenPayload {
    try {
      return this.options.codec.open<CredentialTokenPayload>(token, type);
    } catch {
      throw new InvalidTokenError(`${type === 'access' ? 'Access' : 'Refresh'} token is invalid or expired.`);
    }
  }

  private cleanupReplayState(): void {
    const now = epochSeconds();
    for (const store of [this.consumedCodes, this.consumedRefreshTokens, this.revokedTokens]) {
      for (const [id, expiration] of store) if (expiration <= now) store.delete(id);
    }
  }
}

function serializeParams(params: AuthorizationParams): SerializableAuthorizationParams {
  return {
    state: params.state,
    scopes: params.scopes,
    codeChallenge: params.codeChallenge,
    redirectUri: params.redirectUri,
    resource: params.resource?.toString(),
  };
}

function assertRedirectUri(client: OAuthClientInformationFull, redirectUri: string): void {
  if (!client.redirect_uris.includes(redirectUri)) throw new AccessDeniedError('Unregistered redirect_uri.');
}

function assertClient(actual: string, expected: string): void {
  if (actual !== expected) throw new InvalidGrantError('Token was not issued to this OAuth client.');
}

function assertResource(expected: string | undefined, actual: URL | undefined): void {
  if (actual && expected !== actual.toString()) throw new InvalidGrantError('Resource indicator does not match.');
}

type AuthorizationPageOptions = {
  pending: string;
  clientName: string;
  readOnly: boolean;
  error?: string;
};

function sendAuthorizationPage(response: Response, options: AuthorizationPageOptions): void {
  response.status(200);
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Squarespace</title><style>
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{margin:0;background:#101415;color:#edf3ef;display:grid;min-height:100vh;place-items:center}.card{width:min(34rem,calc(100% - 2rem));box-sizing:border-box;background:#18201d;border:1px solid #34423c;border-radius:16px;padding:2rem;box-shadow:0 18px 60px #0006}h1{margin:.1rem 0 .5rem;font-size:1.7rem}p,li{color:#c6d2cc;line-height:1.5}.mode{display:inline-block;padding:.25rem .55rem;border-radius:99px;background:#284638;color:#bff4d5;font-size:.8rem;font-weight:700}.error{background:#4b2222;color:#ffd5d5;padding:.75rem;border-radius:8px}label{display:block;margin:1.2rem 0 .45rem;font-weight:700}input{box-sizing:border-box;width:100%;padding:.8rem;border-radius:8px;border:1px solid #53635c;background:#0e1210;color:#fff}button{width:100%;margin-top:1rem;padding:.85rem;border:0;border-radius:8px;background:#62d493;color:#092012;font-weight:800;cursor:pointer}small{display:block;color:#93a29b;margin-top:1rem}</style></head>
<body><main class="card"><span class="mode">${options.readOnly ? 'READ ONLY' : 'READ + WRITE'}</span>
<h1>Connect Squarespace</h1><p><strong>${escapeHtml(options.clientName)}</strong> is requesting access through the FloraSync Squarespace MCP server.</p>
${options.error ? `<p class="error">${escapeHtml(options.error)}</p>` : ''}
<ul><li>Your credential is validated directly with Squarespace.</li><li>It is encrypted into short-lived MCP tokens and is not written to a database.</li><li>${options.readOnly ? 'This deployment exposes read-only Squarespace operations.' : 'This deployment can expose operations that modify Squarespace data.'}</li></ul>
<form method="post" action="/oauth/approve"><input type="hidden" name="request" value="${escapeHtml(options.pending)}">
<label for="credential">Squarespace API key or OAuth access token</label><input id="credential" name="credential" type="password" required maxlength="4096" autocomplete="off" spellcheck="false">
<button type="submit">Validate and connect</button></form><small>Only use a server deployment you trust. You can revoke the key in Squarespace at any time.</small></main></body></html>`);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
