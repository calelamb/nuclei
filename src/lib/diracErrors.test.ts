import { describe, it, expect } from 'vitest';
import { describeHttpError, describeThrownError } from './diracErrors';

const AUTH_BODY = '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';

describe('describeHttpError', () => {
  it('maps 401 and 403 to a rejected-key message with an update-key action', () => {
    for (const status of [401, 403]) {
      const info = describeHttpError(status, AUTH_BODY);
      expect(info.kind).toBe('auth');
      expect(info.action).toBe('update-key');
      expect(info.title).toMatch(/key was rejected/i);
      expect(info.message).not.toMatch(/authentication_error|x-api-key|\{/);
      expect(info.details).toContain(String(status));
      expect(info.details).toContain('invalid x-api-key');
    }
  });

  it('maps 429 to a rate-limit message', () => {
    const info = describeHttpError(429, '{}');
    expect(info.kind).toBe('rate_limit');
    expect(info.message).toMatch(/moment/i);
  });

  it('maps 529 and 5xx to a busy message', () => {
    for (const status of [500, 503, 529]) {
      expect(describeHttpError(status, '').kind).toBe('busy');
    }
  });

  it('maps 400 with a credit message to a billing hint', () => {
    const info = describeHttpError(400, '{"error":{"message":"Your credit balance is too low"}}');
    expect(info.kind).toBe('billing');
  });

  it('falls back to a generic message that hides raw JSON', () => {
    const info = describeHttpError(418, '{"weird":true}');
    expect(info.kind).toBe('bad_request');
    expect(info.message).not.toContain('{');
    expect(info.details).toContain('418');
  });
});

describe('describeThrownError', () => {
  it('maps fetch TypeError to offline', () => {
    const info = describeThrownError(new TypeError('Failed to fetch'));
    expect(info.kind).toBe('offline');
    expect(info.title).toMatch(/offline|reach/i);
  });

  it('keeps details for unknown errors', () => {
    const info = describeThrownError(new Error('boom'));
    expect(info.kind).toBe('unknown');
    expect(info.details).toContain('boom');
  });
});
