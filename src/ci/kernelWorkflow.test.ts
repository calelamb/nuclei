import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve('.github/workflows/kernel-tests.yml'), 'utf8');

describe('kernel CI workflow', () => {
  it('installs every dependency required to collect QEC data-engine tests', () => {
    for (const dependency of ['pyarrow', 'duckdb', 'jsonschema']) {
      expect(workflow).toContain(dependency);
    }
  });
});
