import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

// Read version from package.json
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    tui: 'src/tui.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
  shims: true,
  // Inject version at build time
  define: {
    PACKAGE_VERSION: JSON.stringify(pkg.version),
  },
  // Mark packages with dynamic requires as external
  external: [
    'ajv',
    'ajv-formats',
  ],
});
