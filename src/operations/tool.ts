import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { SquarespaceOperation } from './types.js';

export function operationToTool(operation: SquarespaceOperation): Tool {
  return {
    name: operation.name,
    title: operation.title,
    description: operation.description,
    inputSchema: operation.inputSchema as Tool['inputSchema'],
    annotations: {
      title: operation.title,
      readOnlyHint: operation.readOnly,
      destructiveHint: operation.destructive,
      idempotentHint: operation.readOnly,
      openWorldHint: true,
    },
  };
}
