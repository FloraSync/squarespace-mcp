import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { ApiKeyStore } from '../src/auth/api-key-store.js';
import { parseConfig } from '../src/config.js';
import { createHttpApp, startHttpTransport } from '../src/transports/http.js';

const publicUrl = 'http://localhost/mcp';
const redirectUri = 'https://example.com/oauth/callback';
const verifier = 'a'.repeat(64);
const challenge = createHash('sha256').update(verifier).digest('base64url');

describe('remote HTTP and Gemini Spark OAuth contract', () => {
  it('publishes health and OAuth discovery metadata', async () => {
    const app = createApp();
    await request(app)
      .get('/')
      .expect(200, /Connect an MCP client/);
    await request(app)
      .get('/privacy')
      .expect(200, /does not write credentials/);
    await request(app)
      .get('/terms')
      .expect(200, /MIT License/);
    await request(app).get('/healthz').expect(200, { status: 'ok', version: '0.1.0', mode: 'read-only' });
    const protectedMetadata = await request(app).get('/.well-known/oauth-protected-resource/mcp').expect(200);
    expect(protectedMetadata.body).toMatchObject({ resource: publicUrl, authorization_servers: ['http://localhost/'] });
    const authorizationMetadata = await request(app).get('/.well-known/oauth-authorization-server').expect(200);
    expect(authorizationMetadata.body).toMatchObject({
      issuer: 'http://localhost/',
      authorization_endpoint: 'http://localhost/authorize',
      token_endpoint: 'http://localhost/token',
      registration_endpoint: 'http://localhost/register',
    });
  });

  it.each([
    'https://example.com:8443/oauth/callback',
    'http://127.0.0.1:8765/callback/codex',
    'https://example.com/callback;script-src%20*?next=https://other.example',
    'com.example.app:/oauth/callback',
  ])('keeps credential submission same-origin for callback %s', async (callback) => {
    const app = createApp();
    const registered = await register(app, [callback, 'https://unused.example/callback']).expect(201);
    const authorization = await authorize(app, registered.body.client_id, callback).expect(200);
    const directives = String(authorization.headers['content-security-policy']).split(/;\s*/);
    expect(directives.find((directive) => directive.startsWith('form-action '))).toBe("form-action 'self'");
    expect(directives).toContain("default-src 'none'");
    expect(directives).toContain("frame-ancestors 'none'");
  });

  it('rejects an unregistered callback before rendering the consent page', async () => {
    const app = createApp();
    const registered = await register(app).expect(201);
    await authorize(app, registered.body.client_id, 'https://unregistered.example/callback').expect(400);
  });

  it('completes DCR, PKCE authorization, credential validation, token exchange, and MCP initialization', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'website-1' }));
    const app = createApp(fetchMock);
    const registered = await request(app)
      .post('/register')
      .send({
        client_name: 'Gemini Spark test',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      })
      .expect(201);
    expect(registered.body.client_id).toBeTypeOf('string');

    const authorization = await request(app)
      .get('/authorize')
      .query({
        response_type: 'code',
        client_id: registered.body.client_id,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        scope: 'mcp:tools',
        resource: publicUrl,
        state: 'spark-state',
      })
      .expect(200);
    expect(authorization.text).toContain('Connect Squarespace');
    const pending = authorization.text.match(/name="request" value="([^"]+)"/)?.[1];
    expect(pending).toBeTruthy();

    const approval = await request(app)
      .post('/oauth/approve')
      .type('form')
      .send({ request: pending, credential: 'squarespace-key' })
      .expect(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.squarespace.com/1.0/authorization/website');
    expect(approval.headers.location).toBeUndefined();
    expect(approval.headers['cache-control']).toBe('no-store');
    expect(approval.headers['referrer-policy']).toBe('no-referrer');
    const policy = String(approval.headers['content-security-policy']);
    const nonce = policy.match(/script-src 'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(policy).toContain("form-action 'none'");
    expect(approval.text).toContain(`<script nonce="${nonce}">window.location.replace(`);
    expect(approval.text).not.toContain('squarespace-key');
    const redirect = completionRedirect(approval.text);
    expect(redirect.searchParams.get('state')).toBe('spark-state');
    const code = redirect.searchParams.get('code');
    expect(code).toBeTruthy();

    const token = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: registered.body.client_id,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier,
        resource: publicUrl,
      })
      .expect(200);
    expect(token.body).toMatchObject({ token_type: 'bearer', expires_in: 3600 });
    expect(token.body.access_token).not.toContain('squarespace-key');

    const refreshed = await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: registered.body.client_id,
        refresh_token: token.body.refresh_token,
        scope: 'mcp:tools',
        resource: publicUrl,
      })
      .expect(200);
    expect(refreshed.body.access_token).toBeTypeOf('string');
    await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: registered.body.client_id,
        refresh_token: token.body.refresh_token,
        resource: publicUrl,
      })
      .expect(400);

    const initialized = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token.body.access_token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'spark', version: '1' } },
      })
      .expect(200);
    expect(initialized.body.result.serverInfo).toMatchObject({ name: 'squarespace-mcp', version: '0.1.0' });

    await request(app).get('/mcp').set('Authorization', `Bearer ${token.body.access_token}`).expect(405);
    await request(app).delete('/mcp').set('Authorization', `Bearer ${token.body.access_token}`).expect(405);

    await request(app)
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: registered.body.client_id,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier,
        resource: publicUrl,
      })
      .expect(400);
  });

  it('escapes callback state in the completion page while preserving its value', async () => {
    const app = createApp(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'website-1' })));
    const registered = await register(app).expect(201);
    const state = '</script><script>alert("injected")</script>&next=other';
    const authorization = await authorize(app, registered.body.client_id).query({ state }).expect(200);
    const pending = authorization.text.match(/name="request" value="([^"]+)"/)?.[1];
    const approval = await request(app)
      .post('/oauth/approve')
      .type('form')
      .send({ request: pending, credential: 'squarespace-key' })
      .expect(200);
    expect(approval.text).not.toContain(state);
    expect(approval.text.match(/<script\b/g)).toHaveLength(1);
    expect(completionRedirect(approval.text).searchParams.get('state')).toBe(state);
  });

  it('rejects unauthenticated MCP requests and invalid Squarespace credentials', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ message: 'Unauthorized' }, { status: 401 }));
    const app = createApp(fetchMock);
    await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(401);

    const registered = await register(app);
    const authorization = await authorize(app, registered.body.client_id);
    const pending = authorization.text.match(/name="request" value="([^"]+)"/)?.[1];
    const approval = await request(app)
      .post('/oauth/approve')
      .type('form')
      .send({ request: pending, credential: 'bad-key' })
      .expect(200);
    expect(approval.headers['content-security-policy']).toBe(authorization.headers['content-security-policy']);
    expect(approval.text).toContain('Squarespace rejected that credential');
    expect(approval.text).not.toContain('bad-key');
  });

  it('re-renders approval for a missing key and rejects invalid pending requests', async () => {
    const app = createApp(vi.fn<typeof fetch>());
    const registered = await register(app);
    const authorization = await authorize(app, registered.body.client_id);
    const pending = authorization.text.match(/name="request" value="([^"]+)"/)?.[1];
    const missing = await request(app).post('/oauth/approve').type('form').send({ request: pending }).expect(200);
    expect(missing.headers['content-security-policy']).toBe(authorization.headers['content-security-policy']);
    expect(missing.text).toContain('Enter a Squarespace API key');
    await request(app).post('/oauth/approve').type('form').send({ request: 'expired', credential: 'key' }).expect(400);
  });

  it('supports non-OAuth Squarespace developer API keys in insecure-env mode', async () => {
    const developerKey = 'squarespace-developer-key';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ products: [] }));
    const app = createHttpApp({
      publicUrl,
      authMode: 'insecure-env',
      mcpApiKey: 'mcp-development-key',
      credential: developerKey,
      readOnly: true,
      fetchImplementation: fetchMock,
    });

    await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(401);
    await request(app)
      .post('/mcp')
      .set('Authorization', bearer('wrong-key'))
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(401);
    await request(app)
      .post('/mcp')
      .set('Authorization', bearer('mcp-development-key'))
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'squarespace_get_products', arguments: {} },
      })
      .expect(200);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(bearer(developerKey));

    const missingCredentialApp = createHttpApp({
      publicUrl,
      authMode: 'insecure-env',
      mcpApiKey: 'mcp-development-key',
      readOnly: true,
    });
    await request(missingCredentialApp)
      .post('/mcp')
      .set('Authorization', bearer('mcp-development-key'))
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(503);
  });

  it('supports bcrypt API keys in secure-sqlite mode', async () => {
    const database = new DatabaseSync(':memory:');
    const store = new ApiKeyStore(database);
    const apiKey = 'sklive-secure-id.secure-secret';
    store.createApiKey('cloud admin', apiKey);
    const app = createHttpApp({
      publicUrl,
      authMode: 'secure-sqlite',
      apiKeyStore: store,
      credential: 'squarespace-developer-key',
      readOnly: true,
    });

    await request(app)
      .post('/mcp')
      .set('Authorization', bearer('wrong-key'))
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(401);
    await request(app)
      .post('/mcp')
      .set('Authorization', bearer(apiKey))
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);
    expect(
      (
        database.prepare('SELECT lastusedat FROM apikeys WHERE id = ?').get('sklive-secure-id') as {
          lastusedat: string;
        }
      ).lastusedat,
    ).toBeTruthy();
    database.close();
  });

  it('requires an outbound Squarespace credential in secure-sqlite mode', () => {
    const database = new DatabaseSync(':memory:');
    const store = new ApiKeyStore(database);
    expect(() => createHttpApp({ publicUrl, authMode: 'secure-sqlite', apiKeyStore: store, readOnly: true })).toThrow(
      /SQUARESPACE_API_KEY/,
    );
    database.close();
  });

  it('normalizes an origin URL, reports read-write mode, and rejects malformed public URLs', async () => {
    const app = createHttpApp({
      publicUrl: 'http://localhost',
      tokenSecret: 'test-secret-that-is-longer-than-thirty-two-characters',
      readOnly: false,
    });
    await request(app).get('/healthz').expect(200, { status: 'ok', version: '0.1.0', mode: 'read-write' });
    expect(() =>
      createHttpApp({ publicUrl: 'http://localhost/other', tokenSecret: 'x'.repeat(32), readOnly: true }),
    ).toThrow(/\/mcp endpoint/);
    expect(() =>
      createHttpApp({ publicUrl: 'http://localhost/mcp?secret=x', tokenSecret: 'x'.repeat(32), readOnly: true }),
    ).toThrow(/query string/);
  });

  it('starts and stops the Node HTTP transport', async () => {
    const server = await startHttpTransport({
      publicUrl,
      tokenSecret: 'test-secret-that-is-longer-than-thirty-two-characters',
      readOnly: true,
      host: '127.0.0.1',
      port: 0,
    });
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
});

function createApp(fetchImplementation: typeof fetch = vi.fn<typeof fetch>()) {
  const config = parseConfig(['--http'], {
    MCP_PUBLIC_URL: publicUrl,
    MCP_TOKEN_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters',
  });
  if (config.action !== 'run' || config.transport !== 'http') throw new Error('Expected HTTP configuration.');
  return createHttpApp({ ...config, fetchImplementation });
}

function register(app: ReturnType<typeof createHttpApp>, redirectUris = [redirectUri]) {
  return request(app)
    .post('/register')
    .send({
      client_name: 'Gemini Spark test',
      redirect_uris: redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
}

function authorize(app: ReturnType<typeof createHttpApp>, clientId: string, callback = redirectUri) {
  return request(app).get('/authorize').query({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callback,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'mcp:tools',
    resource: publicUrl,
  });
}

function completionRedirect(html: string): URL {
  const target = html.match(/id="oauth-continue" href="([^"]+)"/)?.[1];
  if (!target) throw new Error('OAuth approval did not provide a continuation link.');
  return new URL(target.replaceAll('&amp;', '&'));
}

function bearer(token: string): string {
  return ['Bearer', token].join(' ');
}
