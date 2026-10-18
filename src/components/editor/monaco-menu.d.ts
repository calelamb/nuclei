// Monaco keeps its menu registry in an internal module the public API does not expose; this is the minimal
// shape we touch to drop the stock "Command Palette" entry from the editor's right-click menu.
declare module 'monaco-editor/esm/vs/platform/actions/common/actions.js' {
  export interface MenuItemLike { command?: { id: string } }
  export const MenuId: { readonly EditorContext: object };
  export const MenuRegistry: { getMenuItems(id: object): MenuItemLike[] };
}
