import { z } from 'zod';
import type { Session } from '../app/session';
import { ulid } from '../core/ulid';
import { safeHttpUrl } from '../core/url';
import { nowIso } from '../core/util';
import type { Content, LibraryItem, Project, Shot } from '../data/schema';
import { mutate } from '../data/store';

/**
 * Saga Studio ↔ HQ explicit contracts (ADR-10, revision 3). V1 transports: URL fragment deep link
 * (small payloads; the fragment is never sent to any server) and JSON file/clipboard for larger ones.
 * No shared database, no shared origin, no Drive cross-access assumed (INTEROP-01 not yet run).
 */
export const handoffSchema = z.object({
  type: z.literal('saga.handoff'),
  version: z.literal(1),
  id: z.string(),
  createdAt: z.string(),
  source: z.object({ app: z.literal('saga-hq'), accountHint: z.string().optional() }),
  target: z.object({
    projectId: z.string().optional(),
    projectName: z.string().optional(),
    contentId: z.string(),
    contentTitle: z.string(),
    shotId: z.string().optional(),
  }),
  brief: z.object({
    description: z.string().optional(),
    dialogue: z.string().optional(),
    prompt: z.string().optional(),
    notes: z.string().optional(),
  }),
  format: z.object({
    ratio: z.string().optional(),
    durationSec: z.number().optional(),
    kind: z.enum(['video', 'image']).optional(),
  }),
  modelHint: z
    .object({ family: z.string().optional(), preferred: z.string().nullable().optional() })
    .optional(),
  characters: z.array(z.object({ name: z.string(), studioCharacterId: z.string().nullable().optional() })),
  references: z.array(
    z.object({
      kind: z.string(),
      url: z.string().nullable().optional(),
      driveFileId: z.string().nullable().optional(),
      caption: z.string().optional(),
    }),
  ),
  return: z.object({ mode: z.enum(['file', 'clipboard', 'link']) }),
});
export type Handoff = z.infer<typeof handoffSchema>;

export const returnSchema = z.object({
  type: z.literal('saga.return'),
  version: z.literal(1),
  handoffId: z.string().optional(),
  source: z.object({ app: z.string(), accountHint: z.string().optional() }).optional(),
  target: z.object({ contentId: z.string(), shotId: z.string().optional() }),
  generations: z
    .array(
      z.object({
        studioGenerationId: z.string().optional(),
        provider: z.string().optional(),
        model: z.string().optional(),
        modelVersion: z.string().nullable().optional(),
        prompt: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
        outputs: z.array(
          z.object({
            kind: z.enum(['video', 'image', 'audio']).optional(),
            url: z.string().nullable().optional(),
            driveFileId: z.string().nullable().optional(),
            thumbUrl: z.string().nullable().optional(),
            selected: z.boolean().optional(),
          }),
        ),
        cost: z
          .object({ amount: z.number(), currency: z.string(), unit: z.string().optional() })
          .nullable()
          .optional(),
        createdAt: z.string().optional(),
      }),
    )
    .max(50),
});
export type StudioReturn = z.infer<typeof returnSchema>;

export const MAX_FRAGMENT_CHARS = 6000;

export function buildHandoff(
  content: Content,
  project: Project | undefined,
  refs: LibraryItem[],
  shot: Shot | undefined,
  accountHint?: string,
  ratio?: string,
): Handoff {
  return {
    type: 'saga.handoff',
    version: 1,
    id: ulid(),
    createdAt: nowIso(),
    source: { app: 'saga-hq', ...(accountHint ? { accountHint } : {}) },
    target: {
      ...(project ? { projectId: project.id, projectName: project.name } : {}),
      contentId: content.id,
      contentTitle: content.title,
      ...(shot ? { shotId: shot.id } : {}),
    },
    brief: {
      description: (shot?.description ?? content.concept ?? content.hook ?? '').slice(0, 4000) || undefined,
      dialogue: shot?.dialogue ?? undefined,
      prompt: shot?.prompt ?? undefined,
      notes: content.productionNotes?.slice(0, 2000) ?? undefined,
    },
    format: {
      ...(ratio ? { ratio } : {}),
      ...(shot?.durationSec
        ? { durationSec: shot.durationSec }
        : content.attributes?.durationSec
          ? { durationSec: content.attributes.durationSec }
          : {}),
      kind:
        content.formatTemplateId === 'image_post' || content.formatTemplateId === 'carousel'
          ? 'image'
          : 'video',
    },
    characters: (content.attributes?.cast ?? []).map((name) => ({ name })),
    references: refs.slice(0, 20).map((r) => ({
      kind: r.kind,
      url: safeHttpUrl(r.originalUrl ?? r.thumbUrl ?? null),
      caption: (r.title ?? r.notes ?? '').slice(0, 200),
    })),
    return: { mode: 'file' },
  };
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Response(bytes as BodyInit).body!.pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** Encode for a URL fragment: gzip when available ("z1."), plain otherwise ("j1."). */
export async function encodePayload(obj: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== 'undefined')
    return `z1.${b64urlEncode(await pipe(json, new CompressionStream('gzip')))}`;
  return `j1.${b64urlEncode(json)}`;
}

export async function decodePayload(s: string): Promise<unknown> {
  const [prefix, data] = [s.slice(0, 3), s.slice(3)];
  if (s.length > 200_000) throw new Error('Payload too large');
  if (prefix === 'z1.') {
    if (typeof DecompressionStream === 'undefined')
      throw new Error('This browser cannot decompress the payload');
    return JSON.parse(
      new TextDecoder().decode(await pipe(b64urlDecode(data), new DecompressionStream('gzip'))),
    );
  }
  if (prefix === 'j1.') return JSON.parse(new TextDecoder().decode(b64urlDecode(data)));
  return JSON.parse(s); // raw JSON pasted
}

/** Deep link into Studio. Payload lives in the fragment only (never the query string). */
export function studioDeepLink(studioBaseUrl: string, payload: string): string | null {
  const base = safeHttpUrl(studioBaseUrl);
  if (!base) return null;
  const u = new URL(base);
  u.hash = `saga-handoff=${payload}`;
  return u.toString();
}

export interface ReturnPreview {
  ok: boolean;
  error?: string;
  data?: StudioReturn;
  content?: Content;
  accountMismatch?: boolean;
}

export async function previewReturn(s: Session, raw: unknown, accountHint?: string): Promise<ReturnPreview> {
  const p = returnSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: 'This is not a valid saga.return v1 payload.' };
  const content = await s.db.content.get(p.data.target.contentId);
  if (!content || content.deletedAt)
    return { ok: false, error: 'The content this result belongs to is not in this workspace.' };
  const mismatch = !!(p.data.source?.accountHint && accountHint && p.data.source.accountHint !== accountHint);
  return { ok: true, data: p.data, content, accountMismatch: mismatch };
}

/** Attach returned generations: selected outputs become linked assets; models feed learning attributes. */
export async function applyReturn(s: Session, ret: StudioReturn): Promise<number> {
  const content = await s.db.content.get(ret.target.contentId);
  if (!content) throw new Error('Content not found');
  let attached = 0;
  await mutate(
    s,
    { label: 'Import Saga Studio results' },
    async (m) => {
      const models = new Set(content.attributes?.aiModels ?? []);
      let selectedUrl: string | null = null;
      for (const g of ret.generations) {
        if (g.model) models.add(g.model);
        for (const o of g.outputs) {
          const url = safeHttpUrl(o.url ?? null);
          if (!url && !o.driveFileId) continue;
          if (o.selected && url) selectedUrl = url;
          const lib = await m.create('library', {
            title: `${content.title} — ${g.model ?? 'generation'}${o.selected ? ' (selected)' : ''}`,
            role: 'asset',
            kind: o.kind === 'image' ? 'image' : o.kind === 'audio' ? 'audio' : 'clip',
            originalUrl: url,
            thumbUrl: safeHttpUrl(o.thumbUrl ?? null),
            notes: [
              g.provider && `Provider: ${g.provider}`,
              g.model && `Model: ${g.model}${g.modelVersion ? ` (${g.modelVersion})` : ''}`,
              g.prompt && `Prompt: ${g.prompt.slice(0, 2000)}`,
              g.params && `Params: ${JSON.stringify(g.params).slice(0, 1000)}`,
              g.cost && `Cost: ${g.cost.amount} ${g.cost.currency}`,
              o.driveFileId && `Drive file: ${o.driveFileId}`,
              g.studioGenerationId && `Studio generation: ${g.studioGenerationId}`,
            ]
              .filter(Boolean)
              .join('\n'),
            projectId: content.projectId ?? null,
          });
          await m.create('links', {
            fromType: 'content',
            fromId: content.id,
            toType: 'library',
            toId: lib.id,
            type: 'references',
            note: 'Saga Studio output',
          });
          attached++;
        }
      }
      const patch: Partial<Content> = {
        attributes: { ...(content.attributes ?? {}), aiModels: [...models] },
      };
      if (ret.target.shotId && content.shots) {
        patch.shots = content.shots.map((sh) =>
          sh.id === ret.target.shotId
            ? {
                ...sh,
                ...(selectedUrl ? { selectedOutput: selectedUrl, status: 'selected' as const } : {}),
                rev: s.hlc.now(),
              }
            : sh,
        );
      }
      await m.update('content', content.id, patch);
    },
    { source: 'studio', ...(ret.handoffId ? { handoffId: ret.handoffId } : {}) },
  );
  return attached;
}
