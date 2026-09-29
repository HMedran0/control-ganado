import { describe, expect, it } from 'vitest';

import { assertTestDatabase, SeedRefusedError } from './guards.js';

describe('assertTestDatabase', () => {
  it('acepta solo una base cuyo nombre termina en _test', () => {
    expect(() => {
      assertTestDatabase('postgresql://hato:x@localhost:5433/hato_test');
    }).not.toThrow();
    for (const url of [
      'postgresql://hato:x@localhost:5433/hato',
      'postgresql://hato:x@localhost:5433/hato_test_copia',
      'no-es-una-url',
    ]) {
      expect(() => {
        assertTestDatabase(url);
      }, url).toThrow(SeedRefusedError);
    }
  });
});
