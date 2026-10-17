// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendPostAuthMessages } from './kernelPostAuth';
import { useEditorStore } from '../stores/editorStore';

function fakeSocket() {
  const send = vi.fn();
  return { ws: { send } as unknown as WebSocket, send };
}

const sentTypes = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.map((c) => JSON.parse(c[0] as string).type);

describe('sendPostAuthMessages', () => {
  beforeEach(() => {
    localStorage.clear();
    useEditorStore.setState({ code: '' });
  });

  it('rehydrates hardware state and skips parse for empty code', () => {
    const { ws, send } = fakeSocket();
    sendPostAuthMessages(ws);
    expect(sentTypes(send)).toEqual(['hardware_connected_providers', 'hardware_list_jobs']);
  });

  it('parses open code first', () => {
    useEditorStore.setState({ code: 'H 0' });
    const { ws, send } = fakeSocket();
    sendPostAuthMessages(ws);
    expect(sentTypes(send)[0]).toBe('parse');
  });

  it('migrates legacy credentials to the kernel and wipes them', () => {
    localStorage.setItem('nuclei-hardware-ibm', JSON.stringify({ token: 't' }));
    localStorage.setItem('nuclei-hardware-bad', '{not json');
    const { ws, send } = fakeSocket();
    sendPostAuthMessages(ws);
    expect(sentTypes(send)).toContain('hardware_set_credentials');
    expect(localStorage.getItem('nuclei-hardware-ibm')).toBeNull();
    expect(localStorage.getItem('nuclei-hardware-bad')).toBeNull();
  });
});
