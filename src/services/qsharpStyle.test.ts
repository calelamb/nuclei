// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { QSHARP_STYLE_GUIDE } from './qsharpStyle';

describe('QSHARP_STYLE_GUIDE', () => {
  it('teaches modern QDK 1.x imports', () => {
    expect(QSHARP_STYLE_GUIDE).toContain('import Std');
  });

  it('forbids legacy Microsoft.Quantum namespaces', () => {
    expect(QSHARP_STYLE_GUIDE).toContain('open Microsoft.Quantum');
    expect(QSHARP_STYLE_GUIDE).toContain('legacy');
  });

  it('covers qubit hygiene', () => {
    expect(QSHARP_STYLE_GUIDE).toContain('ResetAll');
  });

  it('teaches DumpMachine for the state panels', () => {
    expect(QSHARP_STYLE_GUIDE).toContain('DumpMachine');
  });
});
