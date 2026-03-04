import { describe, it, expect } from 'vitest';

describe('Project Setup', () => {
  it('should have a working test environment', () => {
    expect(true).toBe(true);
  });

  it('should support TypeScript', () => {
    const message: string = 'TypeScript is working';
    expect(message).toBe('TypeScript is working');
  });

  it('should support async/await', async () => {
    const result = await Promise.resolve('async works');
    expect(result).toBe('async works');
  });
});
