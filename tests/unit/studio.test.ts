import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../../src/app/session';
import { create } from '../../src/data/store';
import {
  applyReturn,
  buildHandoff,
  decodePayload,
  encodePayload,
  handoffSchema,
  previewReturn,
  studioDeepLink,
} from '../../src/studio/handoff';
import { openDevice } from '../helpers';

let s: Session;
afterEach(() => s?.close());

describe('Saga Studio handoff v1', () => {
  it('builds a valid handoff, round-trips through the fragment encoding, and never uses the query string', async () => {
    s = await openDevice();
    const c = await create(s, 'content', {
      title: 'Heist',
      status: 'producing',
      formatTemplateId: 'reel',
      platforms: [],
      concept: 'cold open',
      attributes: { cast: ['Old man'] },
    });
    const h = buildHandoff(c, undefined, [], undefined, 'hint123', '9:16');
    expect(handoffSchema.safeParse(h).success).toBe(true);
    expect(JSON.stringify(h)).not.toMatch(/"sub"/);
    const enc = await encodePayload(h);
    expect(await decodePayload(enc)).toEqual(h);
    const link = studioDeepLink('https://studio.example/app/', enc)!;
    expect(new URL(link).search).toBe('');
    expect(new URL(link).hash).toContain('saga-handoff=');
    expect(studioDeepLink('javascript:alert(1)', enc)).toBeNull();
  });

  it('imports a saga.return as linked assets and records the model', async () => {
    s = await openDevice();
    const c = await create(s, 'content', {
      title: 'Heist',
      status: 'producing',
      formatTemplateId: 'reel',
      platforms: [],
      shots: [{ id: 'sh1', order: 1, description: 'x', referenceIds: [], status: 'generating', rev: 'a' }],
    });
    const ret = {
      type: 'saga.return',
      version: 1,
      target: { contentId: c.id, shotId: 'sh1' },
      generations: [
        {
          provider: 'p',
          model: 'video-model-x',
          prompt: 'prompt',
          outputs: [{ kind: 'video', url: 'https://cdn.example/v.mp4', selected: true }],
        },
      ],
    };
    const pv = await previewReturn(s, ret);
    expect(pv.ok).toBe(true);
    expect(await applyReturn(s, pv.data!)).toBe(1);
    const after = (await s.db.content.get(c.id))!;
    expect(after.attributes?.aiModels).toContain('video-model-x');
    expect(after.shots![0]!.selectedOutput).toBe('https://cdn.example/v.mp4');
    expect(await s.db.library.count()).toBe(1);
    expect((await previewReturn(s, { ...ret, target: { contentId: 'nope' } })).ok).toBe(false);
    expect((await previewReturn(s, { foo: 1 })).ok).toBe(false);
  });
});
