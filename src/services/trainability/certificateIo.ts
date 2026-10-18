/**
 * PRD 14 addendum §D — write the certificate pair through `PlatformBridge`.
 * Existing certificates are replaced (a re-export reflects the latest run).
 */

import type { PlatformBridge } from '../../platform/bridge';
import {
  buildCertificateJson,
  certificatePaths,
  renderCertificateMarkdown,
  serializeCertificateJson,
  type CertificateInput,
} from './certificate';

export class CertificateExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertificateExportError';
  }
}

function joinPath(root: string, relative: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${relative}`;
}

async function writeReplacing(bridge: PlatformBridge, path: string, content: string): Promise<void> {
  if (bridge.createFileExclusive) {
    const outcome = await bridge.createFileExclusive(path, content);
    if (outcome === 'created') return;
    if (outcome === null) throw new CertificateExportError(`Could not create ${path}.`);
  } else {
    const created = await bridge.createFile(path, content);
    if (created) return;
  }
  try {
    await bridge.saveFile(path, content);
  } catch (error) {
    throw new CertificateExportError(
      `Could not overwrite ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface ExportedCertificate {
  jsonPath: string;
  markdownPath: string;
}

export async function exportCertificate(
  bridge: PlatformBridge,
  projectRoot: string | null,
  input: CertificateInput,
): Promise<ExportedCertificate> {
  if (!projectRoot) {
    throw new CertificateExportError('Open a project folder to export a certificate (it is saved under experiments/).');
  }
  const relative = certificatePaths(input.job.target.fileName);
  const jsonPath = joinPath(projectRoot, relative.json);
  const markdownPath = joinPath(projectRoot, relative.markdown);
  // Already-existing directories report null; the writes below surface any real failure.
  try {
    await bridge.createDirectory(joinPath(projectRoot, 'experiments'), true);
  } catch {
    // The directory usually exists already; a real failure surfaces on write.
  }
  await writeReplacing(bridge, jsonPath, serializeCertificateJson(buildCertificateJson(input)));
  await writeReplacing(bridge, markdownPath, renderCertificateMarkdown(input));
  return { jsonPath, markdownPath };
}
