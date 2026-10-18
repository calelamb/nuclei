import { Download, MonitorOff } from 'lucide-react';
import { openExternal } from '../../lib/openExternal';
import { LabButton, LabEmptyState } from './primitives';

/** Where desktop builds are published (the same releases page the What's New dialog links to). */
export const NUCLEI_RELEASES_URL = 'https://github.com/calelamb/nuclei/releases';

/**
 * Shared "this needs the desktop kernel" state. One sentence of why, one
 * action: download the desktop app. `connect_failed` (a desktop build that
 * cannot reach its kernel) gets no download button, since a download will not fix it.
 */
export function LabDesktopRequired({
  feature,
  what,
  reason = 'web_build',
  detail,
}: {
  /** e.g. "The Trainability Lab". */
  feature: string;
  /** What it does natively, e.g. "gradient variance, Lie algebras and loss landscapes". */
  what: string;
  reason?: 'web_build' | 'connect_failed';
  /** The underlying error text for a connect failure. */
  detail?: string;
}) {
  if (reason === 'connect_failed') {
    return (
      <LabEmptyState
        icon={MonitorOff}
        title={`${feature} could not reach the kernel`}
        body={detail ?? 'The Python kernel did not answer. Restart Nuclei, then try again.'}
      />
    );
  }
  return (
    <LabEmptyState
      icon={MonitorOff}
      title={`${feature} runs on the desktop app`}
      body={`It computes ${what} with native Python libraries that the web build cannot run. Download Nuclei for macOS, Windows or Linux to use it.`}
      actions={
        <LabButton variant="primary" icon={Download} onClick={() => void openExternal(NUCLEI_RELEASES_URL)}>
          Download Nuclei
        </LabButton>
      }
    />
  );
}
