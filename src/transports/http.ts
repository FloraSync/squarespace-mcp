import { createServer, type Server as HttpServer } from 'node:http';

import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';

import { createApiKeyMiddleware, extractBearerToken } from '../auth/api-key-middleware.js';
import {
  createInsecureVerifier,
  OAuthSessionStore,
  openApiKeyStore,
  type ApiKeyRecord,
  type AuthMode,
  type ApiKeyStore,
} from '../auth/api-key-store.js';
import { SquarespaceOAuthProvider } from '../auth/provider.js';
import { TokenCodec } from '../auth/token-codec.js';
import { createSquarespaceMcpServer } from '../mcp/server.js';
import type { FetchImplementation } from '../squarespace/client.js';
import { PACKAGE_VERSION } from '../version.js';

const TOOL_SCOPE = 'mcp:tools';

export type HttpTransportOptions = {
  publicUrl: string;
  tokenSecret?: string;
  authMode?: AuthMode;
  mcpApiKey?: string;
  apiKeyStore?: ApiKeyStore;
  databasePath?: string;
  initApiKey?: string;
  masterEncryptionKey?: string;
  credential?: string;
  readOnly: boolean;
  apiBaseUrl?: string;
  fetchImplementation?: FetchImplementation;
};

export function createHttpApp(options: HttpTransportOptions) {
  const endpointUrl = normalizeMcpUrl(options.publicUrl);
  const issuerUrl = new URL(endpointUrl.origin);
  const app = createMcpExpressApp({ host: '0.0.0.0' });
  const authMode = options.authMode ?? 'oauth';
  let provider: SquarespaceOAuthProvider | undefined;
  let sessionStore: OAuthSessionStore | undefined;
  let bearerAuth: RequestHandler;

  app.get('/', (_request, response) => {
    response.type('text/plain').send('FloraSync Squarespace MCP server. Connect an MCP client to /mcp.');
  });
  app.get('/healthz', (_request, response) => {
    response.json({ status: 'ok', version: PACKAGE_VERSION, mode: options.readOnly ? 'read-only' : 'read-write' });
  });
  app.get('/privacy', (_request, response) => {
    response
      .type('text/plain')
      .send(
        authMode === 'oauth'
          ? 'This self-hosted server validates Squarespace credentials directly with Squarespace and encrypts them into short-lived MCP tokens. It does not write credentials or Squarespace data to a database.'
          : 'This self-hosted server authenticates MCP API keys without logging them. Secure mode stores only bcrypt hashes and encrypted OAuth sessions.',
      );
  });
  app.get('/terms', (_request, response) => {
    response
      .type('text/plain')
      .send(
        'This software is provided under the MIT License without warranty. The deployment operator is responsible for access control, availability, and compliance.',
      );
  });

  if (options.authMode === undefined) {
    if (!options.tokenSecret) throw new Error('MCP_TOKEN_SECRET is required for the legacy OAuth HTTP mode.');
    provider = new SquarespaceOAuthProvider({
      codec: new TokenCodec(options.tokenSecret),
      readOnly: options.readOnly,
      apiBaseUrl: options.apiBaseUrl,
      fetchImplementation: options.fetchImplementation,
    });
    app.post(
      '/oauth/approve',
      rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }),
      express.urlencoded({ extended: false, limit: '16kb' }),
      provider.approvalHandler,
    );
    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl,
        resourceServerUrl: endpointUrl,
        scopesSupported: [TOOL_SCOPE],
        resourceName: 'FloraSync Squarespace MCP',
        serviceDocumentationUrl: new URL('https://github.com/FloraSync/squarespace-mcp#readme'),
        clientRegistrationOptions: { clientIdGeneration: false },
      }),
    );
    bearerAuth = requireBearerAuth({
      verifier: provider,
      requiredScopes: [],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(endpointUrl),
    });
  } else if (authMode === 'insecure-env') {
    if (!options.mcpApiKey) throw new Error('MCPAPIKEY is required for insecure-env HTTP mode.');
    bearerAuth = createApiKeyMiddleware(createInsecureVerifier(options.mcpApiKey));
  } else {
    const apiKeyStore =
      options.apiKeyStore ??
      (options.databasePath
        ? openApiKeyStore({
            databasePath: options.databasePath,
            initApiKey: options.initApiKey,
            masterEncryptionKey: options.masterEncryptionKey,
          })
        : undefined);
    if (!apiKeyStore) throw new Error('A SQLite API-key store is required for secure-sqlite HTTP mode.');
    if (options.masterEncryptionKey) sessionStore = new OAuthSessionStore(apiKeyStore, options.masterEncryptionKey);
    bearerAuth = createApiKeyMiddleware((token) => apiKeyStore.verify(token));
  }

  app.post('/mcp', bearerAuth, express.json({ limit: '20mb' }), async (request: Request, response: Response) => {
    const auth = request.auth;
    if (authMode === 'oauth' && !auth) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    const bearerToken = extractBearerToken(request);
    const apiKey = response.locals.apiKey as ApiKeyRecord | undefined;
    const credential =
      authMode === 'oauth'
        ? provider?.credentialFromAccessToken(auth?.token ?? '')
        : (sessionStore?.get(apiKey?.id ?? (bearerToken ? apiKeyIdForSession(bearerToken) : ''))?.accessToken ??
          options.credential ??
          bearerToken);
    if (!credential) {
      response.status(503).json({ error: 'No Squarespace credential is configured for this API key.' });
      return;
    }
    const server = createSquarespaceMcpServer({
      credential,
      readOnly: options.readOnly,
      apiBaseUrl: options.apiBaseUrl,
      fetchImplementation: options.fetchImplementation,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal MCP server error.' },
          id: null,
        });
      }
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  const methodNotAllowed = (_request: Request, response: Response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed for this stateless MCP server.' },
      id: null,
    });
  };
  app.get('/mcp', bearerAuth, methodNotAllowed);
  app.delete('/mcp', bearerAuth, methodNotAllowed);

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    response.status(400).json({ error: message });
  });

  return app;
}

function apiKeyIdForSession(token: string): string {
  const separator = token.indexOf('.');
  return separator > 0 ? token.slice(0, separator) : '';
}

export async function startHttpTransport(
  options: HttpTransportOptions & { host: string; port: number },
): Promise<HttpServer> {
  const app = createHttpApp(options);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

function normalizeMcpUrl(value: string): URL {
  const url = new URL(value);
  if (url.search || url.hash) throw new Error('MCP_PUBLIC_URL must not contain a query string or fragment.');
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/mcp';
  if (url.pathname !== '/mcp') throw new Error('MCP_PUBLIC_URL must use the /mcp endpoint path.');
  return url;
}
