import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, parseActions } from '../../src/ai/actions';
import { type ContextPack, resolveContext } from '../../src/ai/context';
import { buildManualPrompt } from '../../src/ai/prompts';
import { saveSecret } from '../../src/ai/secrets';
import { splitActions, validateAnswer } from '../../src/ai/validate';
import type { Session } from '../../src/app/session';
import { create, undoLast } from '../../src/data/store';
import { openDevice } from '../helpers';

let s: Session;
afterEach(() => s?.close());

const pack: ContextPack = {
  intent: 'producer',
  generatedAt: '',
  today: 'Tuesday',
  facts: ['3 items are marked Ready.'],
  notes: [],
  entities: [
    {
      handle: 'C1',
      type: 'content',
      id: 'content-1',
      fields: { title: 'GTA reel', status: 'producing', nextPublishAt: '2026-10-13T17:30:00Z' },
    },
    { handle: 'T1', type: 'task', id: 'task-1', fields: { title: 'Record voice', status: 'todo' } },
  ],
};

describe('grounding validator', () => {
  it('removes sentences citing unknown records or invented numbers', () => {
    const v = validateAnswer(
      'Facts: 3 items are marked Ready. [C1] is producing. [C9] has 45000 views. It got 87% retention.\nRecommendation: finish [C1] first.',
      pack,
    );
    expect(v.text).toContain('[C1] is producing');
    expect(v.text).not.toContain('C9');
    expect(v.text).not.toContain('87%');
    expect(v.removed.length).toBe(2);
  });
  it('splits the actions block', () => {
    const r = splitActions('Hello\n```actions\n[{"type":"createIdea","title":"x"}]\n```');
    expect(r.body).toBe('Hello');
    expect(r.actionsJson).toContain('createIdea');
  });
});

describe('action model', () => {
  it('rejects unknown handles and destructive actions; classifies risk', () => {
    const acts = parseActions(
      JSON.stringify([
        { type: 'createTask', title: 'Pick cover', content: 'C1' },
        { type: 'createTask', title: 'Bad', content: 'C99' },
        { type: 'changeStatus', target: 'C1', status: 'ready' },
        { type: 'deleteContent', target: 'C1' },
      ]),
      pack,
    );
    expect(acts).toHaveLength(3);
    expect(acts[0]!.risk).toBe('low');
    expect(acts[1]!.invalid).toMatch(/Unknown/);
    expect(acts[2]!.risk).toBe('high');
    expect(acts[2]!.diff).toContain('producing → ready');
  });
  it('applies through the command layer with AI provenance and is undoable', async () => {
    s = await openDevice();
    const c = await create(s, 'content', {
      title: 'Real',
      status: 'producing',
      formatTemplateId: 'reel',
      platforms: [],
    });
    const p: ContextPack = {
      ...pack,
      entities: [{ handle: 'C1', type: 'content', id: c.id, fields: { title: 'Real', status: 'producing' } }],
    };
    const [a] = parseActions(JSON.stringify([{ type: 'createTask', title: 'Pick cover', content: 'C1' }]), p);
    await applyAction(s, a!, p);
    const t = (await s.db.tasks.toArray())[0]!;
    expect(t.contentId).toBe(c.id);
    expect(t.origin?.source).toBe('ai');
    expect(t.origin?.confirmedAt).toBeTruthy();
    await undoLast(s);
    expect((await s.db.tasks.get(t.id))!.deletedAt).toBeTruthy();
  });
});

describe('context resolver', () => {
  it('builds a compact pack without secrets or unrelated records', async () => {
    s = await openDevice();
    await saveSecret(s, 'anthropic', 'sk-ant-SECRETPACKMARKER123456');
    const c = await create(s, 'content', {
      title: 'Producing piece',
      status: 'producing',
      formatTemplateId: 'reel',
      platforms: ['tiktok'],
    });
    await create(s, 'tasks', {
      title: 'Need voice',
      status: 'todo',
      kind: 'task',
      isBlocker: true,
      contentId: c.id,
    });
    await create(s, 'ideas', { title: 'Unrelated idea', status: 'new' });
    const pk = await resolveContext(s, 'producer', 'what is missing?');
    const json = JSON.stringify(pk);
    expect(json).toContain('Producing piece');
    expect(json).not.toContain('Unrelated idea');
    expect(json).not.toContain('SECRETPACKMARKER');
    expect(buildManualPrompt(pk, 'q')).toContain('WORKSPACE CONTEXT');
  });
});
