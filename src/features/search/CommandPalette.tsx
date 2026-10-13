import { useNavigate } from '@tanstack/react-router';
import {
  BookMarked,
  BookOpen,
  CalendarDays,
  CalendarRange,
  CheckSquare,
  Clapperboard,
  FileUp,
  FolderKanban,
  Inbox,
  Lightbulb,
  LineChart,
  Moon,
  Plus,
  Radar,
  Search,
  Settings,
  Sparkles,
  Sun,
  Wand2,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { useApp, useSession } from '../../app/context';
import { create } from '../../data/store';
import { LOCALES, t, translate, useT } from '../../i18n';
import type { SearchHit } from '../../search/core';

const statusText = (type: string, st: string): string =>
  type === 'content'
    ? t(`content.status.${st}`)
    : type === 'ideas'
      ? t(`idea.status.${st}`)
      : type === 'tasks'
        ? t(`task.status.${st}`)
        : type === 'projects'
          ? t(`project.status.${st}`)
          : type === 'chapters'
            ? t(`chapter.status.${st}`)
            : type === 'radar'
              ? ''
              : st;

interface Opt {
  id: string;
  group: string;
  label: string;
  aliases?: string[];
  sub?: string;
  icon?: ReactNode;
  hint?: string;
  run: () => void;
}

/** Navigation entries match their name in BOTH languages (“proyectos” and “projects”). Routes are not localized. */
const bothLangs = (key: string): string[] => LOCALES.map((l) => translate(l, key).toLowerCase());
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
            : h.type === 'chapters'
              ? `/bible/${h.id}`
              : h.type === 'radar'
                ? '/radar'
                : h.type === 'captures'
                  ? '/inbox'
                  : h.type === 'events'
                    ? '/calendar'
                    : '/tasks';

/** ⌘K: go to, create, capture, search everything, ask the Secretary. Fully keyboard driven. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale } = useT();
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
    const [path, qs] = to.split('?');
    void navigate({ to: path!, ...(qs ? { search: Object.fromEntries(new URLSearchParams(qs)) } : {}) });
  };
  const opts: Opt[] = useMemo(() => {
    const ql = q.toLowerCase();
    const commands: Opt[] = [
      {
        id: 'cap',
        group: t('palette.group.commands'),
        label: q ? t('palette.capture_q', { q }) : t('palette.capture'),
        icon: <Plus size={15} />,
        hint: 'C',
        run: () => {
          onClose();
          openCapture(q ? { text: q } : undefined);
        },
      },
      {
        id: 'idea',
        group: t('palette.group.commands'),
        label: q ? t('palette.idea_q', { q }) : t('palette.idea'),
        icon: <Lightbulb size={15} />,
        run: async () => {
          onClose();
          const i = await create(s, 'ideas', { title: q, status: 'new' });
          void navigate({ to: '/ideas/$id', params: { id: i.id } });
        },
      },
      {
        id: 'task',
        group: t('palette.group.commands'),
        label: q ? t('palette.task_q', { q }) : t('palette.task'),
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
        group: t('palette.group.commands'),
        label: q ? t('palette.content_q', { q }) : t('palette.content'),
        icon: <Clapperboard size={15} />,
        run: async () => {
          onClose();
          const c = await create(s, 'content', {
            title: q,
            status: 'planned',
            formatTemplateId: 'reel',
            platforms: [],
          });
          void navigate({ to: '/content/$id', params: { id: c.id } });
        },
      },
      {
        id: 'proj',
        group: t('palette.group.commands'),
        label: q ? t('palette.project_q', { q }) : t('palette.project'),
        icon: <FolderKanban size={15} />,
        run: async () => {
          onClose();
          const p = await create(s, 'projects', {
            name: q || t('projects.new'),
            status: 'active',
            isFocus: false,
            color: 1,
          });
          void navigate({ to: '/projects/$id', params: { id: p.id } });
        },
      },
      {
        id: 'ask',
        group: t('palette.group.commands'),
        label: q ? t('palette.ask_q', { q }) : t('palette.ask'),
        icon: <Sparkles size={15} />,
        hint: '⌘J',
        run: () => {
          onClose();
          toggleSecretary(q ? { intent: 'ask', question: q } : { intent: 'brief' });
        },
      },
      {
        id: 'theme',
        group: t('palette.group.commands'),
        label: t('palette.theme'),
        aliases: bothLangs('palette.theme'),
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
    const nav: Opt[] = (
      [
        ['g-today', '/', <Sun key="i" size={15} />, 'G T', 'nav.today'],
        ['g-inbox', '/inbox', <Inbox key="i" size={15} />, 'G I', 'nav.inbox'],
        ['g-ideas', '/ideas', <Lightbulb key="i" size={15} />, 'G D', 'nav.ideas'],
        ['g-proj', '/projects', <FolderKanban key="i" size={15} />, 'G P', 'nav.projects'],
        ['g-content', '/content', <Clapperboard key="i" size={15} />, 'G C', 'nav.content'],
        ['g-cal', '/calendar', <CalendarDays key="i" size={15} />, 'G A', 'nav.calendar'],
        ['g-lib', '/library', <BookOpen key="i" size={15} />, 'G L', 'nav.library'],
        ['g-ins', '/insights', <LineChart key="i" size={15} />, 'G N', 'nav.insights'],
        ['g-week', '/week', <CalendarRange key="i" size={15} />, 'G W', 'nav.week'],
        ['g-work', '/workshop', <Wand2 key="i" size={15} />, 'G O', 'nav.workshop'],
        ['g-bible', '/bible', <BookMarked key="i" size={15} />, 'G B', 'nav.bible'],
        ['g-radar', '/radar', <Radar key="i" size={15} />, 'G R', 'nav.radar'],
        ['g-import', '/settings?section=import', <FileUp key="i" size={15} />, '', 'import.title'],
        ['g-tasks', '/tasks', <CheckSquare key="i" size={15} />, 'G K', 'nav.tasks_all'],
        ['g-set', '/settings', <Settings key="i" size={15} />, 'G S', 'nav.settings'],
        ['g-search', '/search', <Search key="i" size={15} />, '', 'search.everything'],
      ] as const
    ).map(([id, to, icon, hint, key]) => ({
      id,
      group: t('palette.group.goto'),
      label: t(key),
      aliases: bothLangs(key),
      icon,
      ...(hint ? { hint } : {}),
      run: go(to),
    }));
    const results: Opt[] = hits.map((h) => ({
      id: `${h.type}:${h.id}`,
      group: t('palette.group.results'),
      label: h.title || t('common.untitled'),
      sub: `${t(`search.type.${h.type}`)}${h.status ? ` · ${statusText(h.type, h.status)}` : ''}${h.snippet ? ` · ${h.snippet}` : ''}`,
      icon: <Search size={15} />,
      run: go(routeFor(h)),
    }));
    const matches = (o: Opt) =>
      o.label.toLowerCase().includes(ql) || !!o.aliases?.some((a) => a.includes(ql));
    const filt = (o: Opt) =>
      !ql ||
      matches(o) ||
      o.id.startsWith('cap') ||
      o.id === 'ask' ||
      ['idea', 'task', 'content', 'proj'].includes(o.id);
    return q ? [...nav.filter(matches), ...results, ...commands.filter(filt)] : [...commands, ...nav];
  }, [q, hits, locale]);

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
        <Dialog aria-label={t('nav.search_commands')} style={{ outline: 'none' }}>
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={opts[active] ? `opt-${active}` : undefined}
            aria-label={t('palette.input_aria')}
            placeholder={t('palette.placeholder')}
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
          <div
            className="results"
            id="palette-list"
            role="listbox"
            ref={listRef}
            aria-label={t('palette.group.results')}
          >
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
                {search.ready ? t('palette.no_match') : t('palette.no_match_building')}
              </div>
            )}
          </div>
          <div className="foot">
            <span>{t('palette.foot.nav')}</span>
            <span>{t('palette.foot.open')}</span>
            <span>{t('palette.foot.close')}</span>
            <span style={{ marginLeft: 'auto' }}>{t('palette.foot.offline')}</span>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
