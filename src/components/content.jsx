// Read-only content renderers: Markdown and plain text with glossary-term highlighting.
import { memo, useMemo } from 'react';
import { useApp } from '../app-context.jsx';
import { cn, mdToHtml } from '../lib/format.js';
import { splitByTerms } from '../lib/terms.js';

export const Markdown = memo(function Markdown({ text, className, small }) {
  const html = useMemo(() => mdToHtml(text), [text]);
  return <div className={cn('prose-erad', small && 'prose-sm-erad', className)} dangerouslySetInnerHTML={{ __html: html }} />;
});

/** Plain text where known glossary terms are highlighted and clickable. */
export const Highlighted = memo(function Highlighted({ text }) {
  const { termRegex, openTerm } = useApp();
  const parts = useMemo(() => splitByTerms(text, termRegex), [text, termRegex]);
  return parts.map((p, i) =>
    p.term ? (
      <span
        key={i}
        className="term-hl"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          openTerm(p.text);
        }}
        onKeyDown={(e) => e.key === 'Enter' && openTerm(p.text)}
      >
        {p.text}
      </span>
    ) : (
      p.text
    ),
  );
});
