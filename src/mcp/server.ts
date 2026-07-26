import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { createOperationCatalog } from '../operations/catalog.js';
import { operationToTool } from '../operations/tool.js';
import type { OperationArguments } from '../operations/types.js';
import { SquarespaceApiError, SquarespaceClient, type FetchImplementation } from '../squarespace/client.js';
import { PACKAGE_VERSION, SERVER_NAME, USER_AGENT } from '../version.js';

export type SquarespaceMcpServerOptions = {
  credential: string;
  readOnly: boolean;
  apiBaseUrl?: string;
  fetchImplementation?: FetchImplementation;
};

export function createSquarespaceMcpServer(options: SquarespaceMcpServerOptions): Server {
  const catalog = createOperationCatalog(options.readOnly);
  const client = new SquarespaceClient({
    credential: options.credential,
    userAgent: USER_AGENT,
    baseUrl: options.apiBaseUrl,
    fetchImplementation: options.fetchImplementation,
  });
  const server = new Server({ name: SERVER_NAME, version: PACKAGE_VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: catalog.list().map(operationToTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    try {
      const operation = catalog.get(request.params.name);
      const args = (request.params.arguments ?? {}) as OperationArguments;
      catalog.validate(operation, args);
      const result = await client.execute(operation, args);
      const output = { status: result.status, data: result.data };
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    } catch (error) {
      return toolError(error);
    }
  });

  return server;
}

function toolError(error: unknown): CallToolResult {
  const details =
    error instanceof SquarespaceApiError
      ? {
          error: error.message,
          status: error.status,
          ...(error.contextId ? { contextId: error.contextId } : {}),
          ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        }
      : { error: error instanceof Error ? error.message : 'Unexpected Squarespace MCP error.' };

  return {
    content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
    isError: true,
  };
}
