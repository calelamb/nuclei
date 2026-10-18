/**
 * `DiscoveryFs` over a `PlatformBridge`, so runs persist on desktop, web and
 * the e2e fixture bridge alike. On desktop, `saveFile` overwrites in place.
 * Elsewhere `saveFile` means "download", so overwrites go through
 * delete-then-create instead.
 */

import type { PlatformBridge } from '../../platform/bridge';
import type { DiscoveryFs, JoinFn } from './records';

export const platformJoin: JoinFn = (...parts) =>
  parts
    .filter((p) => p.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/');

export function createPlatformDiscoveryFs(bridge: PlatformBridge): DiscoveryFs {
  return {
    async mkdir(path, options) {
      // createDirectory returns null when the directory already exists.
      await bridge.createDirectory(path, options?.recursive ?? false);
    },
    async writeFile(path, content) {
      if (bridge.getPlatform() === 'desktop') {
        await bridge.saveFile(path, content);
        return;
      }
      await bridge.deleteFile(path);
      if (!(await bridge.createFile(path, content))) {
        throw new Error(`The platform could not create ${path}`);
      }
    },
    readFile: (path) => bridge.readFile(path),
    async readDir(path) {
      const entries = await bridge.listDirectory(path);
      return (entries ?? []).map((e) => ({ name: e.name, isDirectory: e.kind === 'directory' }));
    },
    async exists(path) {
      if ((await bridge.listDirectory(path)) !== null) return true;
      return (await bridge.readFile(path)) !== null;
    },
  };
}
