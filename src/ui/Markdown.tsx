import { Fragment, type ReactNode } from 'react';
import { safeHttpUrl } from '../core/url';

/**
 * Small, safe Markdown renderer for Bible chapters and imported cards. Builds React elements only
 * (no innerHTML): headings, paragraphs, lists, quotes, tables, fenced code, rules, **bold**,
 * *italic*, `code` and [links](https://…) — links are limited to http(s).
 */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return <div className={`md ${className}`}>{blocks(text ?? '')}</div>;
}

function inline(s: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let n = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push(s.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2] || m[3]) out.push(<strong key={k}>{inline(m[2] ?? m[3]!, k)}</strong>);
    else if (m[4]) out.push(<em key={k}>{inline(m[4], k)}</em>);
    else if (m[5]) out.push(<code key={k}>{m[5]}</code>);
    else if (m[6]) {
      const href = safeHttpUrl(m[7]!);
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {inline(m[6], k)}
          </a>
        ) : (
          <Fragment key={k}>{m[6]}</Fragment>
        ),
      );
    }
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${k++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) body.push(lines[i++]!);
      i++;
      out.push(
        <pre key={key} className="md-code">
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(6, h[1]!.length + 1);
      const Tag = `h${level}` as 'h2';
      out.push(<Tag key={key}>{inline(h[2]!, key)}</Tag>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(<hr key={key} />);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      out.push(
        <div key={key} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static text, position is the identity
                  <th key={j}>{inline(c, `${key}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static text, position is the identity
                <tr key={ri}>
                  {r.map((c, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static text, position is the identity
                    <td key={j}>{inline(c, `${key}r${ri}c${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) body.push(lines[i++]!.replace(/^>\s?/, ''));
      out.push(<blockquote key={key}>{blocks(body.join('\n'))}</blockquote>);
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    if (li.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length && (li.test(lines[i]!) || /^\s{2,}\S/.test(lines[i]!))) {
        const m = lines[i]!.match(li);
        if (m) items.push({ depth: m[1]!.length >= 2 ? 1 : 0, text: m[3]! });
        else if (items.length) items[items.length - 1]!.text += ` ${lines[i]!.trim()}`;
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={key}>
          {items.map((it, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static text, position is the identity
            <li key={j} className={it.depth ? 'sub' : undefined}>
              {inline(it.text, `${key}l${j}`)}
            </li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s|\s*\|.*\|\s*$)/.test(lines[i]!)
    )
      para.push(lines[i++]!);
    if (!para.length) {
      // a line no block rule consumed (e.g. a lone table row): render as text
      para.push(lines[i++]!);
    }
    out.push(
      <p key={key}>
        {para.map((l, j) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static text, position is the identity
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(l, `${key}p${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}

/** Plain outline (headings) of a Markdown text, for in-chapter navigation. */
export function outline(text: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  let fence = false;
  for (const l of (text ?? '').split('\n')) {
    if (/^```/.test(l)) fence = !fence;
    const m = !fence && l.match(/^(#{1,4})\s+(.*)$/);
    if (m) out.push({ level: m[1]!.length, text: m[2]!.replace(/[*_`]/g, '') });
  }
  return out;
}
