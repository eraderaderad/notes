// TipTap extension: underlines known glossary terms in the editor and reports clicks on them.
// Uses decorations only, so the saved note content is never modified.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const termHighlightKey = new PluginKey('termHighlight');

export const TermHighlight = Extension.create({
  name: 'termHighlight',
  addOptions() {
    return { getRegex: () => null, onTermClick: () => {} };
  },
  addProseMirrorPlugins() {
    const opt = this.options;
    const build = (doc) => {
      const re = opt.getRegex();
      if (!re) return DecorationSet.empty;
      const decos = [];
      doc.descendants((node, pos, parent) => {
        if (!node.isText || parent?.type.spec.code) return;
        if (node.marks.some((m) => m.type.name === 'code')) return;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(node.text))) {
          if (!m[0].length) {
            re.lastIndex++;
            continue;
          }
          decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, { class: 'term-hl', 'data-term': m[0] }));
        }
      });
      return DecorationSet.create(doc, decos);
    };
    return [
      new Plugin({
        key: termHighlightKey,
        state: {
          init: (_cfg, { doc }) => build(doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(termHighlightKey) ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return termHighlightKey.getState(state);
          },
          handleClick(_view, _pos, event) {
            const el = event.target?.closest?.('.term-hl');
            if (el) opt.onTermClick(el.getAttribute('data-term'));
            return false;
          },
        },
      }),
    ];
  },
});
