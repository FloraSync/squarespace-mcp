import { randomUUID } from 'node:crypto';

import type { OperationArguments, SquarespaceOperation } from '../operations/types.js';

const DEFAULT_API_BASE_URL = 'https://api.squarespace.com';
const DEFAULT_TIMEOUT_MS = 30_000;

export type FetchImplementation = typeof fetch;

export type SquarespaceClientOptions = {
  credential: string;
  userAgent: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
};

export type SquarespaceResult = {
  status: number;
  data: unknown;
};

export class SquarespaceApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly contextId?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'SquarespaceApiError';
  }
}

export class SquarespaceClient {
  private readonly credential: string;
  private readonly userAgent: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;

  constructor(options: SquarespaceClientOptions) {
    if (!options.credential.trim()) throw new Error('A Squarespace API key or OAuth access token is required.');
    this.credential = options.credential.trim();
    this.userAgent = options.userAgent;
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async execute(operation: SquarespaceOperation, args: OperationArguments): Promise<SquarespaceResult> {
    const { url, headers } = this.buildRequest(operation, args);
    const request: RequestInit = {
      method: operation.method,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    if (operation.requestContentType === 'multipart/form-data') {
      request.body = createImageFormData(args);
    } else if (operation.requestContentType) {
      request.body = JSON.stringify(args.body);
      headers.set('Content-Type', operation.requestContentType);
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(url, request);
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new SquarespaceApiError(`Squarespace request timed out after ${this.timeoutMs}ms.`, 504);
      }
      throw new SquarespaceApiError(
        `Unable to reach Squarespace: ${error instanceof Error ? error.message : 'unknown network error'}`,
        502,
      );
    }

    const data = await parseResponseBody(response);
    if (!response.ok) throw createApiError(response, data, this.credential);
    return { status: response.status, data };
  }

  async getWebsiteProfile(): Promise<unknown> {
    const response = await this.fetchImplementation(`${this.baseUrl}/1.0/authorization/website`, {
      headers: this.defaultHeaders(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await parseResponseBody(response);
    if (!response.ok) throw createApiError(response, data, this.credential);
    return data;
  }

  private buildRequest(operation: SquarespaceOperation, args: OperationArguments): { url: string; headers: Headers } {
    let path = operation.path;
    const url = new URL(this.baseUrl);
    const headers = this.defaultHeaders();

    for (const parameter of operation.parameters) {
      let value = args[parameter.inputName];
      if (value === undefined || value === null) {
        if (parameter.wireName === 'Idempotency-Key') value = randomUUID();
        else continue;
      }

      if (parameter.location === 'path') {
        path = path.replace(`{${parameter.wireName}}`, encodeURIComponent(String(value)));
      } else if (parameter.location === 'query') {
        appendQueryValue(url.searchParams, parameter.wireName, value);
      } else {
        headers.set(parameter.wireName, String(value));
      }
    }

    if (/\{[^}]+\}/.test(path)) {
      throw new Error(`Missing a required path parameter for ${operation.name}.`);
    }
    url.pathname = path;
    return { url: url.toString(), headers };
  }

  private defaultHeaders(): Headers {
    return new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${this.credential}`,
      'User-Agent': this.userAgent,
    });
  }
}

function createImageFormData(args: OperationArguments): FormData {
  const imageBase64 = String(args.imageBase64 ?? '');
  const filename = String(args.filename ?? 'image');
  const contentType = String(args.contentType ?? 'application/octet-stream');
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(imageBase64, 'base64')], { type: contentType }), filename);
  return form;
}

function appendQueryValue(searchParams: URLSearchParams, name: string, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) searchParams.append(name, String(item));
    return;
  }
  searchParams.set(name, String(value));
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
  return text;
}

function createApiError(response: Response, data: unknown, credential: string): SquarespaceApiError {
  const record = isRecord(data) ? data : undefined;
  const contextId = stringValue(record?.contextId ?? record?.context_id);
  const upstreamMessage = redactCredential(
    stringValue(record?.message ?? record?.error_description ?? record?.error),
    credential,
  );
  const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
  const advice =
    response.status === 401 || response.status === 403
      ? ' Check the credential and its Squarespace API permissions.'
      : '';
  const retryAdvice = retryAfter ? ` Retry after ${retryAfter} seconds.` : '';
  return new SquarespaceApiError(
    `Squarespace API returned HTTP ${response.status}${upstreamMessage ? `: ${upstreamMessage}` : '.'}${advice}${retryAdvice}`,
    response.status,
    contextId,
    retryAfter,
  );
}

function redactCredential(message: string | undefined, credential: string): string | undefined {
  if (!message) return undefined;
  return message.replaceAll(credential, '[REDACTED]').replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const milliseconds = Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) ? Math.max(0, Math.ceil(milliseconds / 1000)) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
