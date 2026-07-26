import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageMetadata = require('../package.json') as { version: string };

export const PACKAGE_VERSION = packageMetadata.version;
export const SERVER_NAME = 'squarespace-mcp';
export const USER_AGENT = `@florasync/squarespace-mcp/${PACKAGE_VERSION} (+https://github.com/FloraSync/squarespace-mcp)`;
