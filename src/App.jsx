import { useEffect, useRef, useState } from 'react';
import { BookOpen, GraduationCap, LayoutDashboard, Mic, Moon, NotebookPen, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings as SettingsIcon, Sparkles, Sun, Trash2 } from 'lucide-react';
import { useApp } from './app-context.jsx';
import { Button, IconButton } from './components/ui.jsx';
import { cn } from './lib/format.js';
import TermDrawer from './components/TermDrawer.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Notes from './pages/Notes.jsx';
import Recordings from './pages/Recordings.jsx';
import Assistant from './pages/Assistant.jsx';
import Glossary from './pages/Glossary.jsx';
import Study from './pages/Study.jsx';
import Trash from './pages/Trash.jsx';
import Settings from './pages/Settings.jsx';
import SearchPage from './pages/Search.jsx';

const NAV = [
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { view: 'notes', label: 'My Notes', icon: NotebookPen },
  { view: 'recordings', label: 'Recordings', icon: Mic },
  { view: 'assistant', label: 'AI Assistant', icon: Sparkles },
  { view: 'glossary', label: 'Glossary', icon: BookOpen },
  { view: 'study', label: 'Study Materials', icon: GraduationCap },
  { view: 'trash', label: 'Trash', icon: Trash2 },
  { view: 'settings', label: 'Settings', icon: SettingsIcon },
];
const PAGES = { dashboard: Dashboard, notes: Notes, recordings: Recordings, assistant: Assistant, glossary: Glossary, study: Study, trash: Trash, settings: Settings, search: SearchPage };

function Sidebar() {
  const { route, go, ai, settings, saveSettings } = useApp();
  const [width, setWidth] = useState(() => +localStorage.getItem('erad.sidebar') || 224);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('erad.sidebarCollapsed') === '1');
  const dragging = useRef(false);

  useEffect(() => {
    const move = (e) => {
      if (!dragging.current) return;
      const w = Math.min(340, Math.max(184, e.clientX));
      setWidth(w);
      localStorage.setItem('erad.sidebar', w);
    };
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('erad.sidebarCollapsed', c ? '0' : '1');
      return !c;
    });
  };
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <aside className="relative flex shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-150" style={{ width: collapsed ? 56 : width }}>
      <div className={cn('flex h-13 items-center gap-2 px-3', collapsed && 'justify-center px-0')}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-[13px] font-bold text-accent-ink">e</div>
        {!collapsed && <span className="text-[15px] font-semibold tracking-tight">eradnotes</span>}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {NAV.map((n) => {
          const active = route.view === n.view;
          return (
            <button
              key={n.view}
              type="button"
              title={collapsed ? n.label : undefined}
              onClick={() => go(n.view)}
              aria-current={active ? 'page' : undefined}
              className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.75 text-[13px] font-medium transition-colors', collapsed && 'justify-center px-0', active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface2 hover:text-ink', n.view === 'trash' && 'mt-3')}
            >
              <n.icon size={16} className="shrink-0" />
              {!collapsed && <span className="truncate">{n.label}</span>}
            </button>
          );
        })}
      </nav>
      <div className={cn('flex items-center gap-1 border-t border-line p-2', collapsed && 'flex-col')}>
        {!collapsed && (
          <button type="button" onClick={() => go('settings', { section: 'ai' })} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted hover:bg-surface2" title={ai.configured ? ai.label : ai.reason}>
            <span className={cn('h-2 w-2 shrink-0 rounded-full', ai.configured ? 'bg-accent' : 'bg-line')} />
            <span className="truncate">{ai.configured ? (ai.external ? 'AI: cloud' : 'AI: local') : 'AI not set up'}</span>
          </button>
        )}
        <IconButton icon={dark ? Sun : Moon} label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => saveSettings({ theme: dark ? 'light' : 'dark' })} />
        <IconButton icon={collapsed ? PanelLeftOpen : PanelLeftClose} label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggle} />
      </div>
      {!collapsed && (
        <div
          className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize hover:bg-accent/20"
          onMouseDown={() => {
            dragging.current = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />
      )}
    </aside>
  );
}

function TopBar() {
  const { route, go } = useApp();
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => {
    if (route.view === 'search') setQ(route.params.q || '');
  }, [route]);
  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <form
        className="relative max-w-xl flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          go('search', { q });
        }}
      >
        <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
        <input ref={ref} className="input bg-surface2/60 pr-14 pl-8" placeholder="Search notes, transcripts, documents, glossary…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search everything" />
        <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-line bg-surface px-1.5 text-[10px] text-muted">Ctrl K</kbd>
      </form>
      <div className="flex-1" />
      <Button icon={Mic} onClick={() => go('recordings', { record: true })}>
        Record
      </Button>
      <Button variant="primary" icon={Plus} onClick={() => go('notes', { create: true })}>
        New note
      </Button>
    </header>
  );
}

export default function App() {
  const { route } = useApp();
  const Page = PAGES[route.view] || Dashboard;
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Page key={route.view} params={route.params} nav={route.n} />
        </main>
      </div>
      <TermDrawer />
    </div>
  );
}
