import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SQUARESPACE_OPERATIONS } from '../src/generated/operations.js';
import type { SquarespaceOperation } from '../src/operations/types.js';
import { SquarespaceApiError, SquarespaceClient } from '../src/squarespace/client.js';

const credential = 'squarespace-test-secret';
const operation = (operationId: string) =>
  SQUARESPACE_OPERATIONS.find((candidate) => candidate.operationId === operationId) as SquarespaceOperation;

describe('Squarespace API client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const client = new SquarespaceClient({
    credential,
    userAgent: 'test-agent',
    fetchImplementation: fetchMock,
  });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => Response.json({ ok: true }));
  });

  it('builds authenticated URLs and repeated array query parameters', async () => {
    await client.execute(operation('getProducts'), { type: ['PHYSICAL', 'SERVICE'], query: 'fern' });
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/v2/commerce/products');
    expect(parsed.searchParams.getAll('type')).toEqual(['PHYSICAL', 'SERVICE']);
    expect(parsed.searchParams.get('query')).toBe('fern');
    expect(new Headers(request?.headers).get('authorization')).toBe(`Bearer ${credential}`);
    expect(new Headers(request?.headers).get('user-agent')).toBe('test-agent');
  });

  it('encodes path parameters and serializes JSON bodies', async () => {
    await client.execute(operation('patchContact'), { contactId: 'a/b', body: { givenName: 'Ada' } });
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(String(url)).pathname).toBe('/v1/contacts/a%2Fb');
    expect(request?.body).toBe('{"givenName":"Ada"}');
    expect(new Headers(request?.headers).get('content-type')).toBe('application/merge-patch+json');
  });

  it('generates an idempotency key and preserves a caller-provided retry key', async () => {
    await client.execute(operation('createOrder'), { body: {} });
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(firstHeaders.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);

    await client.execute(operation('createOrder'), { idempotencyKey: 'same-request', body: {} });
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(secondHeaders.get('idempotency-key')).toBe('same-request');
  });

  it('uploads product image bytes as multipart form data', async () => {
    await client.execute(operation('uploadProductImage'), {
      productId: 'product',
      imageBase64: Buffer.from('image').toString('base64'),
      filename: 'plant.png',
      contentType: 'image/png',
    });
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBeInstanceOf(Blob);
  });

  it('returns actionable rate-limit errors and redacts credentials', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { message: `Bearer ${credential} exceeded the limit`, contextId: 'ctx-1' },
        { status: 429, headers: { 'Retry-After': '60' } },
      ),
    );
    const error = await client.execute(operation('getProducts'), {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SquarespaceApiError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 60, contextId: 'ctx-1' });
    expect((error as Error).message).not.toContain(credential);
  });

  it('validates credentials against the website profile endpoint', async () => {
    await expect(client.getWebsiteProfile()).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.squarespace.com/1.0/authorization/website');
  });

  it('handles empty, text, and malformed JSON responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(client.execute(operation('deleteContact'), { contactId: 'contact' })).resolves.toEqual({
      status: 204,
      data: null,
    });
    fetchMock.mockResolvedValueOnce(new Response('accepted', { status: 200 }));
    await expect(client.execute(operation('getProducts'), {})).resolves.toEqual({ status: 200, data: 'accepted' });
    fetchMock.mockResolvedValueOnce(
      new Response('{broken', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(client.execute(operation('getProducts'), {})).resolves.toEqual({
      status: 200,
      data: { raw: '{broken' },
    });
  });

  it('converts timeouts and network failures into stable tool errors', async () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValueOnce(timeout);
    await expect(client.execute(operation('getProducts'), {})).rejects.toMatchObject({ status: 504 });
    fetchMock.mockRejectedValueOnce(new Error('socket closed'));
    await expect(client.execute(operation('getProducts'), {})).rejects.toMatchObject({ status: 502 });
  });

  it('rejects blank credentials and incomplete path operations', async () => {
    expect(() => new SquarespaceClient({ credential: ' ', userAgent: 'test' })).toThrow(/required/);
    await expect(client.execute(operation('getOrder'), {})).rejects.toThrow(/path parameter/);
  });
});
