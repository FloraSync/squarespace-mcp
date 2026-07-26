import { createRequire } from 'node:module';

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import type { FormatsPlugin } from 'ajv-formats';

import { SQUARESPACE_OPERATIONS } from '../generated/operations.js';
import type { OperationArguments, SquarespaceOperation } from './types.js';

export class UnknownOperationError extends Error {}

export class InvalidOperationArgumentsError extends Error {
  constructor(
    operationName: string,
    public readonly validationErrors: readonly ErrorObject[],
  ) {
    super(`Invalid arguments for ${operationName}: ${formatValidationErrors(validationErrors)}`);
  }
}

export type OperationCatalog = {
  list: () => readonly SquarespaceOperation[];
  get: (name: string) => SquarespaceOperation;
  validate: (operation: SquarespaceOperation, args: OperationArguments) => void;
};

export function createOperationCatalog(readOnly: boolean): OperationCatalog {
  const operations = SQUARESPACE_OPERATIONS.filter((operation) => !readOnly || operation.readOnly);
  const byName = new Map<string, SquarespaceOperation>(operations.map((operation) => [operation.name, operation]));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const addFormats = createRequire(import.meta.url)('ajv-formats') as FormatsPlugin;
  addFormats(ajv);
  const validators = new Map<string, ValidateFunction>(
    operations.map((operation) => [operation.name, ajv.compile(operation.inputSchema)]),
  );

  return {
    list: () => operations,
    get(name) {
      const operation = byName.get(name);
      if (!operation) {
        throw new UnknownOperationError(
          readOnly && SQUARESPACE_OPERATIONS.some((candidate) => candidate.name === name)
            ? `${name} is unavailable because the server is in read-only mode.`
            : `Unknown Squarespace tool: ${name}`,
        );
      }
      return operation;
    },
    validate(operation, args) {
      const validator = validators.get(operation.name);
      if (!validator) throw new UnknownOperationError(`No validator registered for ${operation.name}`);
      if (!validator(args)) {
        throw new InvalidOperationArgumentsError(operation.name, validator.errors ?? []);
      }
    },
  };
}

function formatValidationErrors(errors: readonly ErrorObject[]): string {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ');
}
