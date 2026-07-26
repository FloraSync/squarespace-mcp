import { describe, expect, it } from 'vitest';

import { SQUARESPACE_OPERATIONS } from '../src/generated/operations.js';
import {
  createOperationCatalog,
  InvalidOperationArgumentsError,
  UnknownOperationError,
} from '../src/operations/catalog.js';

describe('Squarespace operation catalog', () => {
  it('contains every operation in the current official schema with unique MCP names', () => {
    expect(SQUARESPACE_OPERATIONS).toHaveLength(52);
    expect(new Set(SQUARESPACE_OPERATIONS.map((operation) => operation.name)).size).toBe(52);
    expect(SQUARESPACE_OPERATIONS.every((operation) => operation.name.startsWith('squarespace_'))).toBe(true);
  });

  it('exposes only query operations in default read-only mode', () => {
    const catalog = createOperationCatalog(true);
    expect(catalog.list()).toHaveLength(24);
    expect(catalog.list().every((operation) => operation.readOnly)).toBe(true);
    expect(() => catalog.get('squarespace_create_product')).toThrowError(UnknownOperationError);
  });

  it('exposes all operations when writes are enabled', () => {
    expect(createOperationCatalog(false).list()).toHaveLength(52);
  });

  it('validates required path parameters at the server boundary', () => {
    const catalog = createOperationCatalog(true);
    const operation = catalog.get('squarespace_get_order');
    expect(() => catalog.validate(operation, {})).toThrowError(InvalidOperationArgumentsError);
    expect(() => catalog.validate(operation, { id: 'order-id' })).not.toThrow();
  });

  it('contains no unresolved OpenAPI references', () => {
    expect(JSON.stringify(SQUARESPACE_OPERATIONS)).not.toContain('"$ref"');
  });
});
