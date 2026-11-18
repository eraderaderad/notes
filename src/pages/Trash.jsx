import { useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../app-context.jsx';
import { TYPE_ICON } from '../components/SourceTools.jsx';
import { Button, Empty, useDialogs } from '../components/ui.jsx';
import { emit } from '../lib/audio.js';
import { TYPE_LABEL, fmtDate } from '../lib/format.js';

export default function Trash() {
  const { fail, toast } = useApp();
  const { confirm } = useDialogs();
  const [items, setItems] = useState(null);
  const load = () => api('trash.list').then(setItems).catch(fail);
  useEffect(() => void load(), []);

  const act = async (fn, msg) => {
    try {
      await fn();
      emit('recordings');
      emit('documents');
      toast(msg, 'success');
      load();
    } catch (e) {
      fail(e);
    }
  };
  async function purge(it) {
    if (await confirm({ title: `Delete “${it.title}” permanently?`, text: 'This cannot be undone. Any audio or original file is deleted from this PC too.', confirmLabel: 'Delete permanently', danger: true })) act(() => api('trash.purge', { type: it.type, id: it.id }), 'Deleted permanently');
  }
  async function empty() {
    if (await confirm({ title: `Permanently delete ${items.length} item${items.length > 1 ? 's' : ''}?`, text: 'Everything in the Trash, including audio and original files, is removed from this PC. This cannot be undone.', confirmLabel: 'Empty Trash', danger: true })) act(() => api('trash.empty'), 'Trash emptied');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-8 py-3">
        <h1 className="text-lg font-semibold">Trash</h1>
        <span className="text-xs text-muted">Deleted items stay here until you remove them permanently.</span>
        <Button variant="danger" icon={Trash2} className="ml-auto" disabled={!items?.length} onClick={empty}>
          Empty Trash
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items && !items.length ? (
          <Empty icon={Trash2} title="Trash is empty" text="Notes, recordings, documents and study sets you delete can be restored from here." />
        ) : (
          <div className="mx-auto max-w-4xl px-8 py-6">
            <div className="card divide-y divide-line">
              {(items || []).map((it) => {
                const Icon = TYPE_ICON[it.type];
                return (
                  <div key={it.type + it.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Icon size={16} className="shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{it.title}</div>
                      <div className="text-[11px] text-muted">
                        {TYPE_LABEL[it.type]} · deleted {fmtDate(it.deleted_at)}
                      </div>
                    </div>
                    <Button size="sm" icon={RotateCcw} onClick={() => act(() => api('trash.restore', { type: it.type, id: it.id }), 'Restored')}>
                      Restore
                    </Button>
                    <Button size="sm" variant="danger" icon={Trash2} onClick={() => purge(it)}>
                      Delete forever
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
