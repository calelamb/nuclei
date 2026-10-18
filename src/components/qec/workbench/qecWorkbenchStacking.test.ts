import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('stacked workbench canvas', () => {
  it('gives the primary instrument a taller row than the secondary cards', () => {
    const css = readFileSync(join(__dirname, 'qecWorkbench.css'), 'utf8')
    const block = css.slice(css.indexOf('@container qec-canvas (max-width: 659px)'))
    const primary = block.slice(0, block.indexOf('@container qec-canvas (max-width: 440px)'))
    expect(primary).toMatch(/grid-auto-rows:\s*minmax\(max-content,\s*auto\)/)
    expect(primary).toMatch(/\.qec-instrument\s*\{[^}]*min-height:\s*260px/)
    // Only the analysis plot fills a screen-sized card; a figure with a natural size (the timeline) keeps its own height.
    expect(primary).toMatch(/\.qec-instrument--primary\[data-panel='campaign-center'\]:not\(\[data-empty='true'\]\)\s*\{[^}]*(?:min-)?height:\s*max\(520px/)
    // An instrument with nothing to show is a short card with its own height: auto rows of overflow-hidden cards collapse to 2px otherwise.
    expect(primary).toMatch(/\[data-empty='true'\]\s*\{[^}]*min-height:\s*(\d+)px/)
    const empty = Number(primary.match(/\[data-empty='true'\]\s*\{[^}]*min-height:\s*(\d+)px/)![1])
    expect(empty).toBeGreaterThanOrEqual(190)
    expect(empty).toBeLessThan(260)
  })

  it('queries one named container so the grid and its cards switch layout at the same width', () => {
    const css = readFileSync(join(__dirname, 'qecWorkbench.css'), 'utf8')
    const queries = css.match(/@container[^{]*\{/g) ?? []
    expect(queries.length).toBeGreaterThan(0)
    for (const query of queries) expect(query).toMatch(/@container qec-canvas /)
    expect(css).toMatch(/\.qec-investigation\s*\{[^}]*container:\s*qec-canvas\s*\/\s*inline-size/)
  })

  it('keeps the detector graph tall enough to show its canvas, via a selector that works inside the rail', () => {
    const css = readFileSync(join(__dirname, 'qecWorkbench.css'), 'utf8')
    const rule = css.match(/(\.qec-investigation__panels \.qec-instrument\[data-panel='detector-graph'\]:not\(\[data-empty='true'\]\))\s*\{[^}]*min-height:\s*(\d+)px/)
    expect(rule).not.toBeNull()
    expect(Number(rule![2])).toBeGreaterThanOrEqual(440)
    // Declared after every stacked rail rule so none of them lowers the floor.
    expect(css.lastIndexOf(rule![1])).toBeGreaterThan(css.lastIndexOf('.qec-investigation__rail > .qec-instrument'))
    expect(css).not.toMatch(/\.qec-investigation__panels > \.qec-instrument\[data-panel='detector-graph'\]/)
  })

  it('never lets a two-column empty canvas drop a column under 300px', () => {
    const css = readFileSync(join(__dirname, 'qecWorkbench.css'), 'utf8')
    expect(css).toMatch(/\.qec-investigation__panels \{[^}]*grid-template-columns:\s*minmax\(0, 1\.55fr\) minmax\(300px/)
  })
})
