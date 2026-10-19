// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Breadcrumbs } from './Breadcrumbs';
import { useEditorStore } from '../../stores/editorStore';

afterEach(() => cleanup());

describe('Breadcrumbs', () => {
  it('never shows the internal memory: scheme for an unsaved starter file (research-r-08)', () => {
    useEditorStore.setState({ filePath: 'memory://untitled-1.py' });
    const { container } = render(<Breadcrumbs />);
    expect(container.textContent).not.toContain('memory');
    expect(container.textContent).toContain('Unsaved');
    expect(container.textContent).toContain('untitled-1.py');
  });

  it('shows only the file name for an in-memory project path, not its internal id', () => {
    useEditorStore.setState({ filePath: 'memory://project-1760123456/main.py' });
    const { container } = render(<Breadcrumbs />);
    expect(container.textContent).toContain('main.py');
    expect(container.textContent).not.toContain('project-1760');
    expect(container.textContent).not.toContain('memory');
  });

  it('shows the folder trail for a real path', () => {
    useEditorStore.setState({ filePath: '/proj/circuits/bell.py' });
    const { container } = render(<Breadcrumbs />);
    expect(container.textContent).toContain('circuits');
    expect(container.textContent).toContain('bell.py');
    expect(container.textContent).not.toContain('Unsaved');
  });
});
