import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('stacked workbench canvas', () => {
  it('gives the primary instrument a taller row than the secondary cards', () => {
    const css = readFileSync(join(__dirname, 'qecWorkbench.css'), 'utf8')
    const block = css.slice(css.indexOf('@container (max-width: 560px)'))
    const primary = block.slice(0, block.indexOf('@container (max-width: 440px)'))
    expect(primary).toMatch(/grid-auto-rows:\s*auto/)
    expect(primary).toMatch(/\.qec-instrument\s*\{[^}]*min-height:\s*260px/)
    expect(primary).toMatch(/\.qec-instrument--primary\s*\{[^}]*min-height:\s*min\(640px/)
  })
})
