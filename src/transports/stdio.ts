import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createSquarespaceMcpServer } from '../mcp/server.js';

export async function startStdioTransport(options: {
  credential: string;
  readOnly: boolean;
  apiBaseUrl?: string;
}): Promise<void> {
  const server = createSquarespaceMcpServer(options);
  await server.connect(new StdioServerTransport());
}
