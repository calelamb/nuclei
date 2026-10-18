import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('stacked workbench canvas', () => {
  it('gives the primary instrument a taller row than the secondary cards', () => {
    const css = readFileSync(join(__dirname, 'qecWorkbench.css'), 'utf8')
    const block = css.slice(css.indexOf('@container (max-width: 560px)'))
    const primary = block.slice(0, block.indexOf('@container (max-width: 440px)'))
    expect(primary).toMatch(/grid-auto-rows:\s*minmax\(max-content,\s*auto\)/)
    expect(primary).toMatch(/\.qec-instrument\s*\{[^}]*min-height:\s*260px/)
    expect(primary).toMatch(/\.qec-instrument--primary:not\(\[data-empty='true'\]\)\s*\{[^}]*(?:min-)?height:\s*max\(520px/)
    // An instrument with nothing to show is a short card with its own height: auto rows of overflow-hidden cards collapse to 2px otherwise.
    expect(primary).toMatch(/\[data-empty='true'\]\s*\{[^}]*min-height:\s*(\d+)px/)
    const empty = Number(primary.match(/\[data-empty='true'\]\s*\{[^}]*min-height:\s*(\d+)px/)![1])
    expect(empty).toBeGreaterThanOrEqual(190)
    expect(empty).toBeLessThan(260)
  })

  it('keeps the detector graph tall enough to show its 220px canvas, not just a sliver', () => {
    const css = readFileSync(join(__dirname, 'qecWorkbench.css'), 'utf8')
    const rule = css.match(/\[data-panel='detector-graph'\](?::not\(\[data-empty='true'\]\))?\s*\{[^}]*min-height:\s*(\d+)px/)
    expect(rule).not.toBeNull()
    expect(Number(rule![1])).toBeGreaterThanOrEqual(440)
  })
})
