import { describe, expect, it } from 'vitest';
import { describeEngineFailure } from './qecEngineMessage';

describe('describeEngineFailure', () => {
  it('turns the raw start failure into a sentence and keeps the raw text as detail (qec-r-12)', () => {
    const copy = describeEngineFailure('qec_data_start failed: python not found', false);
    expect(copy.headline).toBe("The QEC Data Engine couldn't start. Python wasn't found.");
    expect(copy.detail).toBe('qec_data_start failed: python not found');
  });
  it('says stopped for a dropped connection and never invents a cause', () => {
    expect(describeEngineFailure('socket closed', true).headline).toBe('The QEC Data Engine stopped.');
    expect(describeEngineFailure('weird', false).headline).toBe("The QEC Data Engine couldn't start.");
  });
  it('has no detail when there is no message', () => {
    expect(describeEngineFailure(null, false).detail).toBeNull();
    expect(describeEngineFailure('   ', false).detail).toBeNull();
  });
});
