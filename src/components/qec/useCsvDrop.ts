import { useState, type DragEvent } from 'react';
import { firstFile, loadCsvFile } from '../../services/qecCsvFile';

/** Drop handlers reusable on any container (the whole analysis view). */
export function useCsvDrop() {
  const [over, setOver] = useState(false);
  const isFileDrag = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => { if (isFileDrag(e)) { e.preventDefault(); setOver(true); } },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setOver(false);
        const file = firstFile(e.dataTransfer.files);
        if (file) void loadCsvFile(file);
      },
    },
  };
}
