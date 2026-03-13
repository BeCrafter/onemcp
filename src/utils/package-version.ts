/**
 * Package version utility
 *
 * Reads the project version from package.json at runtime.
 * In production builds, the version is injected at build time.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// In production builds, PACKAGE_VERSION is replaced by tsup during build
declare const PACKAGE_VERSION: string | undefined;

/**
 * Get the package version from package.json.
 *
 * @returns Version string, or '0.0.0' if not found
 */
export function getPackageVersion(): string {
  // Use injected version if available (production build)
  if (typeof PACKAGE_VERSION === 'string' && PACKAGE_VERSION !== 'undefined') {
    return PACKAGE_VERSION;
  }

  // Fallback to reading package.json (development)
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const pkg = createRequire(import.meta.url)(join(__dirname, '../../package.json')) as {
      version?: string;
    };

    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
