import re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[4]
MASTER = (ROOT/'docs/research/PRD_15_QUANTUMNESS_LAB.md').read_text()
AUDIT = (ROOT/'docs/research/PRD_15/00_RELIABILITY_AUDIT.md').read_text()
def section(text, heading_prefix):
    lines = text.splitlines(); out=[]; on=False; lvl=None
    for l in lines:
        m = re.match(r'^(#+)\s', l)
        if m and l.startswith(heading_prefix): on=True; lvl=len(m.group(1)); out.append(l); continue
        if on and m and len(m.group(1)) <= lvl: break
        if on: out.append(l)
    return '\n'.join(out)
def rows(text, unit_bold):
    return [l for l in text.splitlines() if l.startswith('| **'+unit_bold)]
def brief(key, bold, rids, extra_sections, rulings, out):
    parts = [f'# Brief — PRD 15 unit {key}', '',
      'Plan: docs/research/PRD_15_QUANTUMNESS_LAB.md (master). Specs: docs/research/PRD_15/*.md. This brief is your requirements; values in it are binding verbatim.', '',
      '## Your unit (master plan rows — §5.1 Track R table and/or §7 wave table)', '']
    parts += rows(MASTER, bold) or [f'(no table row found for {bold})']
    parts += ['', '## Binding principles (master §2.1)', section(MASTER, '### 2.1')]
    for h in extra_sections: parts += ['', section(MASTER, h)]
    if rids:
        parts += ['', '## Audit items you close (docs/research/PRD_15/00_RELIABILITY_AUDIT.md)']
        for r in rids: parts += ['', section(AUDIT, f'### {r} ')]
    if rulings: parts += ['', '## Controller rulings for this unit (binding)'] + [f'- {x}' for x in rulings]
    pathlib.Path(out).write_text('\n'.join(parts)+'\n')
    print(out, len('\n'.join(parts)))
if __name__ == '__main__':
    import json; cfg = json.loads(sys.argv[1])
    brief(cfg['key'], cfg['bold'], cfg.get('rids', []), cfg.get('sections', []), cfg.get('rulings', []), cfg['out'])
