/**
 * Package version utility
 *
 * Reads the project version from package.json at runtime.
 * Resolves relative to the built output (dist/), so works in development and when installed.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version?: string };

/**
 * Get the package version from package.json.
 *
 * @returns Version string, or '0.0.0' if not found
 */
export function getPackageVersion(): string {
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}
