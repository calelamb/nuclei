import { PanelLayout } from './components/layout/PanelLayout';
import { useKernel } from './hooks/useKernel';
import { useEffect } from 'react';

// Store execute function globally so Monaco keybinding can access it
let executeRef: (() => void) | null = null;
export function getExecute() { return executeRef; }

function App() {
  const { execute } = useKernel();

  useEffect(() => {
    executeRef = execute;
    return () => { executeRef = null; };
  }, [execute]);

  return <PanelLayout />;
}

export default App;
