export type JsonSchema = {
  type?: string | readonly string[];
  title?: string;
  description?: string;
  format?: string;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  items?: JsonSchema;
  oneOf?: readonly JsonSchema[];
  anyOf?: readonly JsonSchema[];
  allOf?: readonly JsonSchema[];
  enum?: readonly unknown[];
  const?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  additionalProperties?: boolean | JsonSchema;
};

export type OperationParameter = {
  inputName: string;
  wireName: string;
  location: 'path' | 'query' | 'header';
  required: boolean;
  schema: JsonSchema;
  description?: string;
};

export type SquarespaceOperation = {
  name: string;
  operationId: string;
  title: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  requestContentType?: 'application/json' | 'application/merge-patch+json' | 'multipart/form-data';
  parameters: readonly OperationParameter[];
  inputSchema: JsonSchema & { type: 'object' };
  readOnly: boolean;
  destructive: boolean;
};

export type OperationArguments = Record<string, unknown>;
