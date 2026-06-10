import { describe, it, expect } from 'vitest';
import { kernelLanguageFor } from './quantum';

describe('kernelLanguageFor', () => {
  it('maps qsharp to the qsharp kernel language', () => {
    expect(kernelLanguageFor('qsharp')).toBe('qsharp');
  });

  it('maps every Python framework to python', () => {
    expect(kernelLanguageFor('qiskit')).toBe('python');
    expect(kernelLanguageFor('cirq')).toBe('python');
    expect(kernelLanguageFor('cuda-q')).toBe('python');
  });
});
