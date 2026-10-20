// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SecretField } from './SecretField';

afterEach(cleanup);

describe('SecretField', () => {
  it('masks by default, reveals from the in-field toggle, and names what it shows', () => {
    render(<SecretField aria-label="Anthropic API key" noun="API key" defaultValue="sk-ant-abc" />);
    const input = screen.getByLabelText('Anthropic API key') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('off');
    fireEvent.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(input.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide API key' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('is the shared bordered TextInput, with the toggle inside its wrapper', () => {
    const { container } = render(<SecretField aria-label="Token" />);
    const input = container.querySelector('input.nuclei-input--mono');
    expect(input).not.toBeNull();
    expect(container.querySelector('.nuclei-input-wrap__trail button')).not.toBeNull();
  });
});
