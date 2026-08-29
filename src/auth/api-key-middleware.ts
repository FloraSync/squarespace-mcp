import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { ApiKeyRecord } from './api-key-store.js';

export type ApiKeyVerifier = (token: string) => Promise<ApiKeyRecord | undefined> | ApiKeyRecord | undefined | boolean;

export function createApiKeyMiddleware(verifier: ApiKeyVerifier): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const token = extractBearerToken(request);
    if (!token) {
      sendUnauthorized(response);
      return;
    }

    void Promise.resolve(verifier(token))
      .then((result) => {
        const valid = typeof result === 'boolean' ? result : result !== undefined;
        if (!valid) {
          sendUnauthorized(response);
          return;
        }
        if (typeof result !== 'boolean') response.locals.apiKey = result;
        next();
      })
      .catch(next);
  };
}

export function extractBearerToken(request: Request): string | undefined {
  const header = request.get('authorization');
  if (!header) return undefined;
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(header);
  return match?.[1];
}

function sendUnauthorized(response: Response): void {
  response.setHeader('WWW-Authenticate', 'Bearer');
  response.status(401).json({ error: 'unauthorized' });
}
