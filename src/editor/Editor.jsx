import { useEffect, useImperativeHandle, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Code, Heading1, Heading2, Heading3, Highlighter, Italic, List, ListChecks, ListOrdered, Minus, Quote, Redo2, SquareCode, Strikethrough, Underline, Undo2 } from 'lucide-react';
import { useApp } from '../app-context.jsx';
import { IconButton } from '../components/ui.jsx';
import { TermHighlight, termHighlightKey } from './termHighlight.js';

function Toolbar({ editor }) {
  const b = (icon, label, run, active) => <IconButton key={label} icon={icon} label={label} active={active} onMouseDown={(e) => e.preventDefault()} onClick={() => run(editor.chain().focus()).run()} />;
  const sep = (k) => <span key={k} className="mx-1 h-4 w-px bg-line" />;
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-3 py-1.5" role="toolbar" aria-label="Formatting">
      {b(Heading1, 'Heading 1', (c) => c.toggleHeading({ level: 1 }), editor.isActive('heading', { level: 1 }))}
      {b(Heading2, 'Heading 2', (c) => c.toggleHeading({ level: 2 }), editor.isActive('heading', { level: 2 }))}
      {b(Heading3, 'Subheading', (c) => c.toggleHeading({ level: 3 }), editor.isActive('heading', { level: 3 }))}
      {sep(1)}
      {b(Bold, 'Bold (Ctrl+B)', (c) => c.toggleBold(), editor.isActive('bold'))}
      {b(Italic, 'Italic (Ctrl+I)', (c) => c.toggleItalic(), editor.isActive('italic'))}
      {b(Underline, 'Underline (Ctrl+U)', (c) => c.toggleUnderline(), editor.isActive('underline'))}
      {b(Strikethrough, 'Strikethrough', (c) => c.toggleStrike(), editor.isActive('strike'))}
      {b(Highlighter, 'Highlight', (c) => c.toggleHighlight(), editor.isActive('highlight'))}
      {b(Code, 'Inline code', (c) => c.toggleCode(), editor.isActive('code'))}
      {sep(2)}
      {b(List, 'Bullet list', (c) => c.toggleBulletList(), editor.isActive('bulletList'))}
      {b(ListOrdered, 'Numbered list', (c) => c.toggleOrderedList(), editor.isActive('orderedList'))}
      {b(ListChecks, 'Checklist', (c) => c.toggleTaskList(), editor.isActive('taskList'))}
      {sep(3)}
      {b(SquareCode, 'Code block', (c) => c.toggleCodeBlock(), editor.isActive('codeBlock'))}
      {b(Quote, 'Quote', (c) => c.toggleBlockquote(), editor.isActive('blockquote'))}
      {b(Minus, 'Divider', (c) => c.setHorizontalRule(), false)}
      {sep(4)}
      {b(Undo2, 'Undo (Ctrl+Z)', (c) => c.undo(), false)}
      {b(Redo2, 'Redo (Ctrl+Y)', (c) => c.redo(), false)}
    </div>
  );
}

/**
 * Rich text editor. `initialHtml` is read once per mount (key the component by note id).
 * handle.getSelectionText() returns the currently selected text.
 */
export default function Editor({ initialHtml, onChange, handle, header }) {
  const { termRegex, openTerm } = useApp();
  const regexRef = useRef(termRegex);
  regexRef.current = termRegex;
  const openRef = useRef(openTerm);
  openRef.current = openTerm;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  const editor = useEditor({
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing… Use the toolbar for headings, lists, checklists and code blocks.' }),
      TermHighlight.configure({ getRegex: () => regexRef.current, onTermClick: (t) => openRef.current(t) }),
    ],
    content: initialHtml || '',
    editorProps: { attributes: { class: 'prose-erad min-h-full px-10 py-6 max-w-3xl mx-auto', spellcheck: 'true' } },
    onUpdate: ({ editor }) => changeRef.current?.({ html: editor.getHTML(), text: editor.getText({ blockSeparator: '\n\n' }) }),
  });

  // Re-run highlighting when the glossary changes.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(termHighlightKey, true));
  }, [termRegex, editor]);

  useImperativeHandle(
    handle,
    () => ({
      getSelectionText: () => {
        if (!editor) return '';
        const { from, to } = editor.state.selection;
        return from === to ? '' : editor.state.doc.textBetween(from, to, '\n\n');
      },
      focus: () => editor?.commands.focus(),
    }),
    [editor],
  );

  if (!editor) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar editor={editor} />
      <div className="min-h-0 flex-1 overflow-y-auto" onClick={(e) => e.target === e.currentTarget && editor.commands.focus('end')}>
        {header}
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
