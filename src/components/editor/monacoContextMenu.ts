import { MenuId, MenuRegistry } from 'monaco-editor/esm/vs/platform/actions/common/actions.js';

/** Monaco's own quick-command action. Nuclei has one palette (the app's), so this one is hidden from the menu. */
export const STOCK_PALETTE_COMMAND_ID = 'editor.action.quickCommand';

interface MenuItemLike { command?: { id: string } }
interface RegistryLike { getMenuItems(id: object): MenuItemLike[] }

const PATCHED = Symbol.for('nuclei.contextMenuPatched');

/** Pure: the items without Monaco's stock command palette. */
export function withoutStockPalette<T extends MenuItemLike>(items: readonly T[]): T[] {
  return items.filter((item) => item.command?.id !== STOCK_PALETTE_COMMAND_ID);
}

/**
 * Wrap `getMenuItems` so the editor context menu never lists Monaco's own (Title Case, F1-labelled) palette.
 * Idempotent, and a no-op if Monaco's internals ever change shape: the stock menu then simply stays.
 */
export function hideStockPaletteFromContextMenu(
  registry: RegistryLike = MenuRegistry,
  editorContextId: object = MenuId.EditorContext,
): boolean {
  const target = registry as RegistryLike & { [PATCHED]?: boolean };
  if (target[PATCHED]) return true;
  if (typeof target.getMenuItems !== 'function' || !editorContextId) return false;
  const original = target.getMenuItems.bind(target);
  target.getMenuItems = (id: object) => {
    const items = original(id);
    return id === editorContextId ? withoutStockPalette(items) : items;
  };
  target[PATCHED] = true;
  return true;
}
