import { forwardRef } from 'react';
import { blochCaption, describeBlochState, type BlochAudience, type BlochVector } from '../../lib/blochMath';
import './bloch.css';

interface Props {
  qubit: number;
  label: string;
  /** Narrow cells show the compact readout; the full text stays in the tooltip. */
  compact: boolean;
  coord: BlochVector;
  /** Learners see 'Entangled' (or nothing for a pure state); researchers see the numbers. */
  audience: BlochAudience;
  /** The qubit's starting state |0> before any run: captioned 'Initial state'. */
  initial?: boolean;
}

/**
 * One qubit's box. The shared canvas draws the sphere into `.bloch-cell__viewport`
 * (the forwarded ref); this component owns only the DOM: frame, caption, readout.
 */
export const BlochCell = forwardRef<HTMLDivElement, Props>(function BlochCell({ qubit, label, compact, coord, audience, initial = false }, viewportRef) {
  const readout = describeBlochState(coord);
  const caption = initial ? 'Initial state' : blochCaption(readout, audience, compact);
  return (
    <div
      className="bloch-cell"
      data-kind={readout.kind}
      title={initial ? 'Starting state |0>, before any run' : readout.detail}
      role="img"
      aria-label={`Qubit ${qubit} Bloch sphere. ${initial ? 'Starting state |0>, before any run.' : readout.detail}`}
    >
      <div ref={viewportRef} className="bloch-cell__viewport" />
      <div className="bloch-cell__caption">
        {label && <span className="bloch-cell__qubit">{label}</span>}
        {caption && <span className="bloch-cell__readout">{caption}</span>}
      </div>
    </div>
  );
});
