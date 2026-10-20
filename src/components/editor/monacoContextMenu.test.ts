import { describe, expect, it } from 'vitest';
import { hideStockPaletteFromContextMenu, withoutStockPalette } from './monacoContextMenu';

const ctx = {};
const other = {};
const items = [
  { command: { id: 'editor.action.clipboardCopyAction' } },
  { command: { id: 'editor.action.quickCommand' } },
  { command: { id: 'nuclei.compose' } },
];

describe('editor context menu', () => {
  it('drops only the stock command palette', () => {
    expect(withoutStockPalette(items).map((i) => i.command.id)).toEqual(['editor.action.clipboardCopyAction', 'nuclei.compose']);
  });

  it('filters the editor context menu but leaves other menus alone, and patches once', () => {
    const registry = { getMenuItems: (id: object) => (id === ctx || id === other ? items : []) };
    expect(hideStockPaletteFromContextMenu(registry, ctx)).toBe(true);
    const patched = registry.getMenuItems;
    expect(hideStockPaletteFromContextMenu(registry, ctx)).toBe(true);
    expect(registry.getMenuItems).toBe(patched);
    expect(registry.getMenuItems(ctx)).toHaveLength(2);
    expect(registry.getMenuItems(other)).toHaveLength(3);
  });

  it('does nothing if the registry has no getMenuItems', () => {
    expect(hideStockPaletteFromContextMenu({} as never, ctx)).toBe(false);
  });
});
