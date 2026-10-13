import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { t, useT } from '../../i18n';
import type { SearchHit } from '../../search/core';
import { Empty } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';

const route = (h: SearchHit) =>
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

export function SearchPage() {
  useT();
  const { search } = useApp();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    let alive = true;
    if (q.trim().length >= 2) void search.search(q, 60).then((h) => alive && setHits(h));
    else setHits([]);
    return () => {
      alive = false;
    };
  }, [q, search]);
  return (
    <div className="page narrow">
      <PageHeader back title={t('nav.search')} />
      <input
        className="input"
        autoFocus
        type="search"
        placeholder={t('search.everything')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={t('search.everything')}
        style={{ marginBottom: 12 }}
      />
      {q.trim().length >= 2 && !hits.length ? (
        <Empty compact>{t('search.no_results')}</Empty>
      ) : (
        <div className="list">
          {hits.map((h) => (
            <Link key={`${h.type}:${h.id}`} to={route(h)} className="row">
              <div className="grow">
                <div className="title">{h.title || t('common.untitled')}</div>
                <div className="sub">
                  {t(`search.type.${h.type}`)} · {h.snippet}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
