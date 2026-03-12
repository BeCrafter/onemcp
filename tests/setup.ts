/**
 * Global test setup file
 * Suppress unhandled errors from child processes in tests
 */

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
  // Re-throw other unhandled rejections
  throw reason;
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
  // Re-throw other uncaught exceptions
  throw error;
});
