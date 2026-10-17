import { Fragment, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { splitMarkdownTables, type TableBlock } from '../../lib/markdownTables';
import './markdown.css';

interface Props {
  markdown: string;
  components?: Components;
}

function Cell({ text, components }: { text: string; components?: Components }) {
  // Cells are inline content: drop the paragraph wrapper so it does not add block margins.
  const inline: Components = { ...components, p: ({ children }) => <Fragment>{children}</Fragment> };
  return <ReactMarkdown components={inline}>{text}</ReactMarkdown>;
}

function MarkdownTable({ block, components }: { block: TableBlock; components?: Components }) {
  return (
    <div className="nuclei-md-table-wrap" role="region" tabIndex={0} aria-label="Table">
      <table className="nuclei-md-table">
        <thead>
          <tr>
            {block.header.map((h, i) => (
              <th key={i} scope="col" style={{ textAlign: block.align[i] ?? 'left' }}>
                <Cell text={h} components={components} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} style={{ textAlign: block.align[c] ?? 'left' }}>
                  <Cell text={cell} components={components} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** react-markdown plus the table support it lacks without remark-gfm. */
export function MarkdownWithTables({ markdown, components }: Props) {
  const segments = useMemo(() => splitMarkdownTables(markdown), [markdown]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'table'
          ? <MarkdownTable key={i} block={seg} components={components} />
          : <ReactMarkdown key={i} components={components}>{seg.text}</ReactMarkdown>,
      )}
    </>
  );
}
