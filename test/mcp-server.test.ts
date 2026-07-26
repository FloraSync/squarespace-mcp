import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSquarespaceMcpServer } from '../src/mcp/server.js';

describe('MCP server contract', () => {
  const connected: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(connected.splice(0).map((item) => item.close()));
  });

  it('lists only read tools by default and returns structured Squarespace responses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ products: [{ id: 'p1' }] }));
    const server = createSquarespaceMcpServer({
      credential: 'secret',
      readOnly: true,
      fetchImplementation: fetchMock,
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    connected.push(client, server);

    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(24);
    expect(listed.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);

    const result = await client.callTool({ name: 'squarespace_get_products', arguments: { query: 'moss' } });
    expect(result.structuredContent).toEqual({ status: 200, data: { products: [{ id: 'p1' }] } });
    expect(result.isError).not.toBe(true);
  });

  it('returns tool errors for unknown or write operations in read-only mode', async () => {
    const server = createSquarespaceMcpServer({ credential: 'secret', readOnly: true });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    connected.push(client, server);

    const result = await client.callTool({ name: 'squarespace_create_product', arguments: { body: {} } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('read-only mode');
  });
});
