/**
 * Replaces `process.stderr.write` with a no-op that returns true.
 * Used during stdio MCP shutdown so the MCP Inspector does not call
 * `webAppTransport.send()` on a closed SSE transport after disconnect.
 */
export function silenceStderrForShutdown(): void {
  const stream = process.stderr as NodeJS.WriteStream;
  stream.write = ((): boolean => true) as typeof stream.write;
}
