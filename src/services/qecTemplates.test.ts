import { describe, it, expect } from 'vitest';
import { QEC_TEMPLATES } from './qecTemplates';
import { distanceFromLabel } from './qecCampaignRunner';
import { parseExperimentYaml } from '../types/experiment';

describe('QEC experiment templates', () => {
  it('offers the repetition and surface memory templates', () => {
    expect(QEC_TEMPLATES.map((t) => t.id)).toEqual(['repetition-memory', 'surface-memory']);
  });

  for (const template of QEC_TEMPLATES) {
    describe(template.id, () => {
      const scaffold = template.build('My Study');

      it('writes an editable Python entry and a campaign YAML', () => {
        const py = scaffold.files.find((f) => f.language === 'python');
        const yaml = scaffold.files.find((f) => f.language === 'yaml');
        expect(py).toBeTruthy();
        expect(yaml).toBeTruthy();
        // The entry defines the nuclei_circuits(noise) contract, not a hidden circuit.
        expect(py!.content).toContain('def nuclei_circuits(noise');
        expect(py!.content).toContain('stim.Circuit.generated');
        expect(py!.relPath.startsWith('qec/')).toBe(true);
        expect(yaml!.relPath.startsWith('experiments/')).toBe(true);
      });

      it('produces a YAML that parses as a valid qec_campaign pointing at the entry', () => {
        const yaml = scaffold.files.find((f) => f.language === 'yaml')!;
        const result = parseExperimentYaml(yaml.content, yaml.relPath.split('/').pop()!);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.spec.type).toBe('qec_campaign');
        if (result.spec.type !== 'qec_campaign') return;
        expect('entry' in result.spec.source).toBe(true);
        if (!('entry' in result.spec.source)) return;
        expect(result.spec.source.entry).toBe(scaffold.entryRelPath);
        expect(result.spec.decoders).toContain('pymatching');
      });

      it('labels its circuits d=3/5/7 so the threshold panel can fit Λ', () => {
        const py = scaffold.files.find((f) => f.language === 'python')!;
        expect(py.content).toContain('f"d={d}"');
        // The runner parses that convention into a numeric distance.
        expect(distanceFromLabel('d=3')).toBe(3);
        expect(distanceFromLabel('d=5')).toBe(5);
        expect(distanceFromLabel('d=7')).toBe(7);
      });
    });
  }
});

describe('distanceFromLabel', () => {
  it('parses the d=<n> convention (and d<n>), ignoring labels without a distance', () => {
    expect(distanceFromLabel('d=3')).toBe(3);
    expect(distanceFromLabel('d5')).toBe(5);
    expect(distanceFromLabel('surface d=11 z')).toBe(11);
    expect(distanceFromLabel('baseline')).toBeNull();
    expect(distanceFromLabel('d=1')).toBeNull(); // distance < 2 is not a code
  });
});
