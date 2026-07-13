import { useEffect } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useThemeStore } from '../stores/themeStore';
import { useProjectStore } from '../stores/projectStore';

/**
 * PRD 11 Phase B — the visual + window-title signature of the active mode.
 *
 * Two always-on identity signals, driven by workspace mode:
 *  1. `--mode-accent` CSS variable on the document root — Dirac purple in
 *     Research, quantum teal in Learn. The activity bar reads it for its 2px
 *     top border (a subtle signature, not a theme fork). Re-applied when the
 *     theme flips so the accent tracks the light/dark palette.
 *  2. Window title — `<project> — Nuclei Research` / `<project> — Nuclei`, so
 *     the OS window/taskbar identifies the mode even when unfocused. Set via
 *     the platform bridge (native window title on desktop) plus `document.title`
 *     (tab title on web).
 *
 * Mounted once, near the app root.
 */
function projectName(root: string | null): string | null {
  if (!root) return null;
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

export function useModeIdentity(): void {
  const platform = usePlatform();
  const mode = useWorkspaceStore((s) => s.mode);
  const colors = useThemeStore((s) => s.colors);
  const projectRoot = useProjectStore((s) => s.projectRoot);

  // --mode-accent
  useEffect(() => {
    const accent = mode === 'research' ? colors.dirac : colors.accent;
    document.documentElement.style.setProperty('--mode-accent', accent);
    document.documentElement.dataset.workspaceMode = mode;
  }, [mode, colors.dirac, colors.accent]);

  // Window title
  useEffect(() => {
    const suffix = mode === 'research' ? 'Nuclei Research' : 'Nuclei';
    const name = projectName(projectRoot);
    const title = name ? `${name} — ${suffix}` : suffix;
    document.title = title;
    platform.setWindowTitle(title).catch(() => {
      /* non-critical: native title unavailable in some environments */
    });
  }, [mode, projectRoot, platform]);
}
