import { useNavigate } from '@tanstack/react-router';
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  Clapperboard,
  FolderKanban,
  Inbox,
  Lightbulb,
  LineChart,
  Moon,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { useApp, useSession } from '../../app/context';
import { create } from '../../data/store';
import type { SearchHit, SearchType } from '../../search/core';

interface Opt {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon?: ReactNode;
  hint?: string;
  run: () => void;
}

const TYPE_LABEL: Record<SearchType, string> = {
  projects: 'Project',
  ideas: 'Idea',
  captures: 'Inbox',
  content: 'Content',
  tasks: 'Task',
  library: 'Library',
  learnings: 'Learning',
  events: 'Event',
};
const routeFor = (h: SearchHit): string =>
  h.type === 'content'
    ? `/content/${h.id}`
    : h.type === 'ideas'
      ? `/ideas/${h.id}`
      : h.type === 'projects'
        ? `/projects/${h.id}`
        : h.type === 'library'
          ? `/library/${h.id}`
          : h.type === 'learnings'
            ? `/learnings/${h.id}`
            : h.type === 'captures'
              ? '/inbox'
              : h.type === 'events'
                ? '/calendar'
                : '/tasks';

/** ⌘K: go to, create, capture, search everything, ask the Secretary. Fully keyboard driven. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSession();
  const { search, openCapture, toggleSecretary } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => {
    let alive = true;
    if (q.trim().length >= 2) void search.search(q, 30).then((h) => alive && setHits(h));
    else setHits([]);
    return () => {
      alive = false;
    };
  }, [q, search]);

  const go = (to: string) => () => {
    onClose();
    void navigate({ to });
  };
  const opts: Opt[] = useMemo(() => {
    const ql = q.toLowerCase();
    const commands: Opt[] = [
      {
        id: 'cap',
        group: 'Commands',
        label: q ? `Capture “${q}”` : 'Capture…',
        icon: <Plus size={15} />,
        hint: 'C',
        run: () => {
          onClose();
          openCapture(q ? { text: q } : undefined);
        },
      },
      {
        id: 'idea',
        group: 'Commands',
        label: q ? `Create idea “${q}”` : 'Create idea',
        icon: <Lightbulb size={15} />,
        run: async () => {
          onClose();
          const i = await create(s, 'ideas', { title: q || 'New idea', status: 'new' });
          void navigate({ to: '/ideas/$id', params: { id: i.id } });
        },
      },
      {
        id: 'task',
        group: 'Commands',
        label: q ? `Add task “${q}”` : 'Add task',
        icon: <CheckSquare size={15} />,
        hint: 'T',
        run: async () => {
          onClose();
          if (q) await create(s, 'tasks', { title: q, status: 'todo', kind: 'task', isBlocker: false });
          else openCapture({ mode: 'task' });
        },
      },
      {
        id: 'content',
        group: 'Commands',
        label: q ? `Create content “${q}”` : 'Create content',
        icon: <Clapperboard size={15} />,
        run: async () => {
          onClose();
          const c = await create(s, 'content', {
            title: q || 'Untitled content',
            status: 'planned',
            formatTemplateId: 'reel',
            platforms: [],
          });
          void navigate({ to: '/content/$id', params: { id: c.id } });
        },
      },
      {
        id: 'proj',
        group: 'Commands',
        label: q ? `Create project “${q}”` : 'Create project',
        icon: <FolderKanban size={15} />,
        run: async () => {
          onClose();
          const p = await create(s, 'projects', {
            name: q || 'New project',
            status: 'active',
            isFocus: false,
            color: 1,
          });
          void navigate({ to: '/projects/$id', params: { id: p.id } });
        },
      },
      {
        id: 'ask',
        group: 'Commands',
        label: q ? `Ask Secretary: “${q}”` : 'Ask Secretary',
        icon: <Sparkles size={15} />,
        hint: '⌘J',
        run: () => {
          onClose();
          toggleSecretary(q ? { intent: 'ask', question: q } : { intent: 'brief' });
        },
      },
      {
        id: 'theme',
        group: 'Commands',
        label: 'Toggle light / dark',
        icon: document.documentElement.dataset.theme === 'light' ? <Moon size={15} /> : <Sun size={15} />,
        run: () => {
          const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
          document.documentElement.dataset.theme = next;
          try {
            localStorage.setItem('hq:theme', next);
          } catch {
            /* ignore */
          }
          onClose();
        },
      },
    ];
    const nav: Opt[] = [
      { id: 'g-today', group: 'Go to', label: 'Today', icon: <Sun size={15} />, hint: 'G T', run: go('/') },
      {
        id: 'g-inbox',
        group: 'Go to',
        label: 'Inbox',
        icon: <Inbox size={15} />,
        hint: 'G I',
        run: go('/inbox'),
      },
      {
        id: 'g-ideas',
        group: 'Go to',
        label: 'Ideas',
        icon: <Lightbulb size={15} />,
        hint: 'G D',
        run: go('/ideas'),
      },
      {
        id: 'g-proj',
        group: 'Go to',
        label: 'Projects',
        icon: <FolderKanban size={15} />,
        hint: 'G P',
        run: go('/projects'),
      },
      {
        id: 'g-content',
        group: 'Go to',
        label: 'Content',
        icon: <Clapperboard size={15} />,
        hint: 'G C',
        run: go('/content'),
      },
      {
        id: 'g-cal',
        group: 'Go to',
        label: 'Calendar',
        icon: <CalendarDays size={15} />,
        hint: 'G A',
        run: go('/calendar'),
      },
      {
        id: 'g-lib',
        group: 'Go to',
        label: 'Library',
        icon: <BookOpen size={15} />,
        hint: 'G L',
        run: go('/library'),
      },
      {
        id: 'g-ins',
        group: 'Go to',
        label: 'Insights',
        icon: <LineChart size={15} />,
        hint: 'G N',
        run: go('/insights'),
      },
      {
        id: 'g-tasks',
        group: 'Go to',
        label: 'All tasks',
        icon: <CheckSquare size={15} />,
        hint: 'G K',
        run: go('/tasks'),
      },
      {
        id: 'g-set',
        group: 'Go to',
        label: 'Settings',
        icon: <Settings size={15} />,
        hint: 'G S',
        run: go('/settings'),
      },
    ];
    const results: Opt[] = hits.map((h) => ({
      id: `${h.type}:${h.id}`,
      group: 'Results',
      label: h.title || '(untitled)',
      sub: `${TYPE_LABEL[h.type]}${h.status ? ` · ${h.status}` : ''}${h.snippet ? ` · ${h.snippet}` : ''}`,
      icon: <Search size={15} />,
      run: go(routeFor(h)),
    }));
    const filt = (o: Opt) =>
      !ql ||
      o.label.toLowerCase().includes(ql) ||
      o.id.startsWith('cap') ||
      o.id === 'ask' ||
      ['idea', 'task', 'content', 'proj'].includes(o.id);
    return q
      ? [...results, ...commands.filter(filt), ...nav.filter((o) => o.label.toLowerCase().includes(ql))]
      : [...commands, ...nav];
  }, [q, hits]);

  useEffect(() => {
    if (active >= opts.length) setActive(Math.max(0, opts.length - 1));
  }, [opts.length, active]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let lastGroup = '';
  return (
    <ModalOverlay className="modal-overlay" isOpen={open} onOpenChange={(o) => !o && onClose()} isDismissable>
      <Modal className="modal wide palette">
        <Dialog aria-label="Search and commands" style={{ outline: 'none' }}>
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={opts[active] ? `opt-${active}` : undefined}
            aria-label="Search everything or type a command"
            placeholder="Search everything, or type a command…  (type:idea, status:ready, is:archived)"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, opts.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                opts[active]?.run();
              }
            }}
          />
          <div className="results" id="palette-list" role="listbox" ref={listRef} aria-label="Results">
            {opts.map((o, i) => {
              const isNewGroup = o.group !== lastGroup;
              lastGroup = o.group;
              const header = isNewGroup ? (
                <div key={`g-${o.group}`} className="group" role="presentation">
                  {o.group}
                </div>
              ) : null;
              return (
                <div key={o.id}>
                  {header}
                  <div
                    id={`opt-${i}`}
                    data-idx={i}
                    role="option"
                    aria-selected={i === active}
                    className="opt"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => o.run()}
                    onKeyDown={() => {}}
                  >
                    <span aria-hidden style={{ color: 'var(--text-3)' }}>
                      {o.icon}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div>{o.label}</div>
                      {o.sub && <div className="sub">{o.sub}</div>}
                    </span>
                    {o.hint && <kbd className="kbd">{o.hint}</kbd>}
                  </div>
                </div>
              );
            })}
            {q.trim().length >= 2 && hits.length === 0 && (
              <div className="opt meta">
                No matching records{search.ready ? '' : ' (index still building…)'}.
              </div>
            )}
          </div>
          <div className="foot">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
            <span style={{ marginLeft: 'auto' }}>Search works offline, on this device only</span>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
