// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendPostAuthMessages } from './kernelPostAuth';
import { useEditorStore } from '../stores/editorStore';
import { requestHardwareBackends, setHardwareBackendsSender } from '../lib/hardwareBackendsSender';

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

  it('lets the UI ask the kernel for live backends once authenticated', () => {
    const send = vi.fn();
    const ws = { send, readyState: WebSocket.OPEN } as unknown as WebSocket;
    sendPostAuthMessages(ws);
    send.mockClear();
    expect(requestHardwareBackends()).toBe(true);
    expect(sentTypes(send)).toEqual(['hardware_list_backends']);
    setHardwareBackendsSender(null);
    expect(requestHardwareBackends()).toBe(false);
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
