import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve('.github/workflows/qec-frontend.yml');

describe('QEC frontend PR workflow', () => {
  it('gates Node 24 unit tests and the real Chromium QEC flow', () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
    if (!existsSync(WORKFLOW_PATH)) return;
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('push:');
    expect(workflow).toContain('node-version: 24');
    expect(workflow).toContain('python-version: \'3.12\'');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('playwright install --with-deps chromium');
    for (const dependency of ['pyarrow', 'duckdb', 'jsonschema', 'websockets', 'stim']) {
      expect(workflow).toContain(dependency);
    }
    expect(workflow).toContain('npm run test:e2e -- --grep @qec --workers=1');
    expect(workflow).not.toMatch(/10M|10_000_000|QEC_STRESS/i);
  });
});
