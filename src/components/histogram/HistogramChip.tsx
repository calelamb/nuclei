import { X, Maximize2, Info } from 'lucide-react';
import { IconButton, Tooltip } from '../ui';
import { useSimulationStore } from '../../stores/simulationStore';
import { SAMPLE_EXPLAINER, SAMPLE_LABEL } from '../../hooks/runSummary';
import { EDITOR_FOCUS_TARGET, focusAfterUnmount } from '../../hooks/focusAfterUnmount';
import './histogram.css';
import { useThemeStore } from '../../stores/themeStore';
import { useElementSize } from '../../hooks/useElementSize';
import { chooseChipLayout } from './chipLayout';
import { formatChipPercent } from './histogramScale';

import { TYPOGRAPHY } from '../../styles/tokens';
interface HistogramChipProps {
  probabilities: Record<string, number> | null;
  /**
   * Optional hardware-run probabilities. When present the chip renders two
   * stacked bars per outcome: classical (simulator) in the accent color,
   * hardware in the research blue. Makes the "real quantum hardware matches
   * the simulator — mostly" teaching moment visible at a glance.
   */
  hwProbabilities?: Record<string, number> | null;
  hwLabel?: string;
  onDismiss?: () => void;
  onExpand?: () => void;
}

const EPSILON = 1e-6;
const MAX_BARS = 3;
const MAX_LABEL_BITS = 8;

/** Keep long bitstrings readable in a narrow chip: |0000…0000⟩. */
function chipLabel(state: string): string {
  if (state.length <= MAX_LABEL_BITS) return state;
  const half = MAX_LABEL_BITS / 2;
  return `${state.slice(0, half)}…${state.slice(-half)}`;
}

/**
 * Compact inline histogram — the top outcomes by probability. One line while every
 * outcome fits with its percentage; stacked ket / bar / percentage rows when the
 * rail is too narrow, so a bitstring or percentage is never clipped.
 */
export function HistogramChip({
  probabilities,
  hwProbabilities,
  hwLabel,
  onDismiss,
  onExpand,
}: HistogramChipProps) {
  const colors = useThemeStore((s) => s.colors);
  const [measureRef, size] = useElementSize<HTMLDivElement>();
  const shotCount = useSimulationStore((s) => s.result?.shot_count ?? 0);

  if (!probabilities) return null;

  // Union of classical + hardware outcomes — we want every state that either
  // side saw. Rank by max(p_classical, p_hardware) so the top-3 are the
  // outcomes that actually matter regardless of which side produced them.
  const merged: Record<string, { cls: number; hw: number; max: number }> = {};
  for (const [s, p] of Object.entries(probabilities)) {
    if (p > EPSILON) merged[s] = { cls: p, hw: 0, max: p };
  }
  if (hwProbabilities) {
    for (const [s, p] of Object.entries(hwProbabilities)) {
      if (p <= EPSILON) continue;
      const prev = merged[s] ?? { cls: 0, hw: 0, max: 0 };
      merged[s] = { cls: prev.cls, hw: p, max: Math.max(prev.max, p) };
    }
  }
  const ranked = Object.entries(merged)
    .sort((a, b) => b[1].max - a[1].max || a[0].localeCompare(b[0]));
  const entries = ranked.slice(0, MAX_BARS);
  const hiddenCount = ranked.length - entries.length;
  const hiddenLabel = hiddenCount.toLocaleString('en-US');

  if (entries.length === 0) return null;

  const hasHw = !!hwProbabilities;
  const layout = chooseChipLayout(entries.map(([s]) => chipLabel(s)), size.width, hasHw);
  const rows = layout === 'rows';

  // The dismissed chip takes its own button with it: keep the keyboard in the editor.
  const dismiss = () => {
    focusAfterUnmount(document.activeElement, [EDITOR_FOCUS_TARGET]);
    onDismiss?.();
  };

  const sampleCaption = !hasHw && shotCount > 0 ? `${SAMPLE_LABEL} · ${shotCount.toLocaleString('en-US')} ${shotCount === 1 ? 'shot' : 'shots'}` : null;
  // The explainer lives on its own focusable trigger so Expand and Dismiss keep their own tooltips.
  const sampleInfo = sampleCaption && !rows && (
    <Tooltip label={`${sampleCaption}. ${SAMPLE_EXPLAINER}`} placement="above">
      <button type="button" aria-label="About the Nuclei sample" className="histogram-chip__info"><Info size={12} /></button>
    </Tooltip>
  );

  const controls = (
    <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center', marginLeft: rows ? 'auto' : undefined }}>
      {sampleInfo}
      {hiddenCount > 0 && (onExpand ? (
        <button
          type="button"
          aria-label={`Show ${hiddenLabel} more outcomes`}
          onClick={onExpand}
          className="histogram-chip__more"
        >
          +{hiddenLabel} more
        </button>
      ) : (
        <span className="histogram-chip__more histogram-chip__more--static" title={`${hiddenLabel} more outcomes. Open the full histogram to see them.`}>
          +{hiddenLabel} more
        </span>
      ))}
      {onExpand && (
        <IconButton size="sm" className="histogram-chip__icon" aria-label="Expand histogram" tooltip={{ placement: 'above' }} onClick={onExpand}>
          <Maximize2 size={12} />
        </IconButton>
      )}
      {onDismiss && (
        <IconButton size="sm" className="histogram-chip__icon histogram-chip__icon--danger" aria-label="Dismiss histogram" tooltip={{ placement: 'above' }} onClick={dismiss}>
          <X size={12} />
        </IconButton>
      )}
    </div>
  );

  const chip = (
    <div
      ref={measureRef}
      data-layout={layout}
      style={{
        display: 'flex',
        flexDirection: rows ? 'column' : 'row',
        alignItems: rows ? 'stretch' : 'center',
        gap: rows ? 6 : 12,
        minWidth: 0,
        padding: '6px 10px',
        background: `${colors.accent}0A`,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        fontSize: 11,
        fontFamily: TYPOGRAPHY.fontSans,
      }}
    >
      {/* Stacked: the expand/dismiss controls ride on a header row above the outcomes (no spare row below). */}
      {rows && (
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <span style={{ color: colors.textDim, fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Top outcomes
            {sampleCaption && (
              <Tooltip label={`${sampleCaption}. ${SAMPLE_EXPLAINER}`} placement="below">
                <span data-testid="histogram-chip-sample" tabIndex={0} role="note" aria-label="About the Nuclei sample" className="histogram-chip__caption"> · {sampleCaption}</span>
              </Tooltip>
            )}
          </span>
          {controls}
        </div>
      )}
      <div
        style={{
          display: 'flex', flexDirection: rows ? 'column' : 'row', alignItems: rows ? 'stretch' : 'center',
          gap: rows ? 4 : 10, flex: rows ? undefined : 1, minWidth: 0, overflow: 'hidden',
        }}
      >
        {entries.map(([state, { cls, hw }]) => (
          <div
            key={state}
            data-testid="histogram-chip-bar"
            style={{ display: 'flex', alignItems: 'center', gap: 6, flex: rows ? undefined : '1 1 0', minWidth: 0, whiteSpace: 'nowrap' }}
          >
            <span
              title={`|${state}⟩`}
              style={{ fontFamily: TYPOGRAPHY.fontMono, color: colors.accentText, flexShrink: 0 }}
            >
              |{chipLabel(state)}⟩
            </span>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <div
                className="histogram-chip__bar"
                style={{ height: hasHw ? 4 : 6, borderRadius: 3, background: `${colors.accent}14`, overflow: 'hidden' }}
                title="Classical simulation"
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.round(cls * 100)}%`,
                    background: colors.accent,
                    transition: 'width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                />
              </div>
              {hasHw && (
                <div
                  className="histogram-chip__bar"
                  style={{ height: 4, borderRadius: 3, background: `${colors.modeResearch}14`, overflow: 'hidden' }}
                  title={hwLabel ?? 'Hardware run'}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.round(hw * 100)}%`,
                      background: colors.modeResearch,
                      transition: 'width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                </div>
              )}
            </div>
            <span
              style={{
                color: colors.textDim,
                minWidth: hasHw ? 54 : 28,
                textAlign: 'right',
                flexShrink: 0,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {hasHw
                ? `${formatChipPercent(cls)} · ${formatChipPercent(hw)}`
                : formatChipPercent(cls)}
            </span>
          </div>
        ))}
      </div>
      {!rows && controls}
    </div>
  );
  return chip;
}
