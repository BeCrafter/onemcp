import { describe, it } from 'vitest';
import * as fc from 'fast-check';

describe('Property Testing Setup', () => {
  it('should support fast-check property tests', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a; // Commutative property of addition
      }),
      { numRuns: 100 }
    );
  });

  it('should support async property tests', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (str) => {
        const result = await Promise.resolve(str);
        return result === str;
      }),
      { numRuns: 100 }
    );
  });
});
