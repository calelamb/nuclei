export function exportDisabledReason({ errorLine, previewPaused }: { errorLine: number | null; previewPaused: boolean }): string {
  if (errorLine !== null) return `Fix line ${errorLine} to export`;
  return previewPaused ? 'Run the code to export' : 'Fix the code error to export';
}
