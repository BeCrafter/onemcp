/**
 * Global test setup file
 * Suppress unhandled errors from child processes in tests
 */

// Ink short-circuits its render loop in CI mode (CI=true): it stores each
// frame in `lastOutput` and only flushes to stdout on unmount(), so any test
// that drives a live Ink render and reads the captured stdout sees a blank
// terminal. Force CI off so renders flush on every frame, matching local dev.
process.env['CI'] = 'false';

// Suppress unhandled rejections from transport processes
process.on('unhandledRejection', (reason) => {
  // Only suppress TransportError with PROCESS_EXITED code
  if (
    reason &&
    typeof reason === 'object' &&
    'name' in reason &&
    reason.name === 'TransportError' &&
    'code' in reason &&
    reason.code === 'PROCESS_EXITED'
  ) {
    // Suppress this error in tests
    return;
  }
  // Log instead of throwing — throwing inside unhandledRejection kills the
  // vitest fork worker, causing "Worker exited unexpectedly" errors.
  console.error('[unhandledRejection]', reason);
});

// Suppress uncaught exceptions from transport processes
process.on('uncaughtException', (error) => {
  // Only suppress TransportError with PROCESS_EXITED code
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'TransportError' &&
    'code' in error &&
    (error as { code: string }).code === 'PROCESS_EXITED'
  ) {
    // Suppress this error in tests
    return;
  }
  // Log instead of throwing — throwing inside uncaughtException kills the
  // vitest fork worker, causing "Worker exited unexpectedly" errors.
  console.error('[uncaughtException]', error);
});
