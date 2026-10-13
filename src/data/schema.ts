import { z } from 'zod';

/** Current local schema version. Bump with a migration in migrations.ts. */
export const SCHEMA_VERSION = 1;

export const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'youtube_shorts', 'x', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];

const iso = z.string();
const opt = <T extends z.ZodType>(t: T) => t.nullish();

export const provenanceSchema = z.object({
  source: z.enum(['user', 'capture', 'ai', 'import', 'studio', 'sync']),
  captureId: z.string().optional(),
  aiActionId: z.string().optional(),
  importBatchId: z.string().optional(),
  handoffId: z.string().optional(),
  confirmedAt: z.string().optional(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

const base = {
  id: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(64),
  schemaVersion: z.number().int().min(1),
  createdAt: iso,
  updatedAt: iso,
  updatedByDevice: z.string(),
  rev: z.string(),
  fieldRevs: z.record(z.string(), z.string()),
  fieldPrev: z.record(z.string(), z.string()).optional(),
  archivedAt: opt(iso),
  deletedAt: opt(iso),
  trashGroup: opt(z.string()),
  origin: provenanceSchema.optional(),
};

const tags = z.array(z.string().max(60)).max(50).optional();
const priority = z.enum(['low', 'med', 'high']).nullish();
const platforms = z.array(z.enum(PLATFORMS)).max(10);

export const cadenceSchema = z.object({
  platform: z.enum(PLATFORMS),
  perWeek: z.number().min(0).max(50),
  preferredDays: z.array(z.number().int().min(0).max(6)).optional(),
});

export const READINESS_KEYS = [
  'hook',
  'script',
  'references',
  'finalExport',
  'cover',
  'coverText',
  'caption',
  'hashtags',
  'publishDate',
] as const;
export type ReadinessKey = (typeof READINESS_KEYS)[number];
export const SHEET_SECTIONS = ['concept', 'references', 'generate', 'edit', 'package', 'publish'] as const;
export type SheetSection = (typeof SHEET_SECTIONS)[number];

export const formatTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  ratio: z.string().optional(),
  defaultDurationSec: z.number().optional(),
  platforms: platforms,
  sections: z.array(z.enum(SHEET_SECTIONS)),
  required: z.array(z.enum(READINESS_KEYS)),
});
export type FormatTemplate = z.infer<typeof formatTemplateSchema>;

export const focusRefSchema = z.object({
  entity: z.enum(['content', 'task', 'idea', 'project']),
  id: z.string(),
});
export type FocusRef = z.infer<typeof focusRefSchema>;

export const workspaceSchema = z.looseObject({
  ...base,
  name: z.string().max(120),
  platforms: platforms,
  cadence: z.array(cadenceSchema),
  formatTemplates: z.array(formatTemplateSchema),
  focus: z.array(focusRefSchema).max(3),
  onboardedAt: opt(iso),
  scoringEnabled: z.boolean().optional(),
});

export const projectSchema = z.looseObject({
  ...base,
  name: z.string().min(1).max(200),
  status: z.enum(['active', 'paused', 'done']),
  goal: opt(z.string().max(500)),
  brief: opt(z.string().max(50000)),
  startDate: opt(iso),
  endDate: opt(iso),
  isFocus: z.boolean(),
  color: z.number().int().min(1).max(8),
  platforms: platforms.optional(),
});

const score = z.object({
  value: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  by: z.enum(['user', 'ai']),
  rationale: z.string().optional(),
});

export const ideaSchema = z.looseObject({
  ...base,
  title: z.string().max(300),
  raw: opt(z.string().max(50000)),
  hook: opt(z.string().max(2000)),
  concept: opt(z.string().max(50000)),
  whyItWorks: opt(z.string().max(5000)),
  tone: opt(z.string().max(60)),
  format: opt(z.string().max(60)),
  platforms: platforms.optional(),
  topic: opt(z.string().max(100)),
  cast: z.array(z.string().max(100)).max(30).optional(),
  projectId: opt(z.string()),
  parentIdeaId: opt(z.string()),
  variantLabel: opt(z.string().max(60)),
  status: z.enum(['new', 'shortlisted', 'committed', 'parked']),
  priority,
  scores: z.record(z.string(), score).optional(),
  notes: opt(z.string().max(50000)),
  tags,
});

export const captureSchema = z.looseObject({
  ...base,
  text: opt(z.string().max(50000)),
  url: opt(z.string().max(4000)),
  canonicalUrl: opt(z.string().max(4000)),
  mediaIds: z.array(z.string()).max(20),
  mode: z.enum(['text', 'voice', 'photo', 'video', 'file', 'link', 'task']),
  status: z.enum(['inbox', 'triaged']),
  suggestion: z
    .object({
      type: z.enum(['idea', 'task', 'library', 'content']),
      role: z.enum(['inspiration', 'reference', 'asset']).optional(),
      title: z.string().optional(),
      by: z.enum(['rule', 'ai']),
      reason: z.string().optional(),
    })
    .nullish(),
  resultRef: z.object({ entity: z.string(), id: z.string() }).nullish(),
  projectId: opt(z.string()),
});

export const shotSchema = z.object({
  id: z.string(),
  order: z.number(),
  title: opt(z.string().max(200)),
  description: z.string().max(10000),
  durationSec: opt(z.number().min(0).max(36000)),
  dialogue: opt(z.string().max(10000)),
  prompt: opt(z.string().max(20000)),
  notes: opt(z.string().max(10000)),
  referenceIds: z.array(z.string()).max(50),
  selectedOutput: opt(z.string().max(4000)),
  status: z.enum(['todo', 'generating', 'selected', 'final']),
  rev: z.string(),
  deleted: z.boolean().optional(),
});
export type Shot = z.infer<typeof shotSchema>;

export const CONTENT_STATUSES = [
  'planned',
  'producing',
  'ready',
  'scheduled',
  'published',
  'reviewed',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const contentSchema = z.looseObject({
  ...base,
  title: z.string().max(300),
  projectId: opt(z.string()),
  ideaId: opt(z.string()),
  status: z.enum(CONTENT_STATUSES),
  formatTemplateId: z.string(),
  platforms: platforms,
  priority,
  objective: opt(z.string().max(2000)),
  audience: opt(z.string().max(2000)),
  hook: opt(z.string().max(2000)),
  concept: opt(z.string().max(50000)),
  script: opt(z.string().max(100000)),
  productionNotes: opt(z.string().max(50000)),
  editNotes: opt(z.string().max(50000)),
  shots: z.array(shotSchema).max(200).optional(),
  coverMediaId: opt(z.string()),
  coverUrl: opt(z.string().max(4000)),
  coverText: opt(z.string().max(500)),
  caption: opt(z.string().max(10000)),
  hashtags: z.array(z.string().max(100)).max(60).optional(),
  audioNote: opt(z.string().max(2000)),
  finalExportUrl: opt(z.string().max(4000)),
  finalExportMediaId: opt(z.string()),
  sectionDone: z.record(z.string(), z.boolean()).optional(),
  attributes: z
    .object({
      topic: opt(z.string()),
      hookType: opt(z.enum(['question', 'dialogue', 'cold_open', 'reveal', 'text', 'other'])),
      tone: opt(z.string()),
      durationSec: opt(z.number()),
      hasDialogue: opt(z.boolean()),
      visualStyle: opt(z.string()),
      cast: z.array(z.string()).optional(),
      aiModels: z.array(z.string()).optional(),
    })
    .optional(),
  reviewedAt: opt(iso),
  tags,
  // Derived (recomputed locally on write; never trusted from remote/imports)
  _readyPct: z.number().optional(),
  _missing: z.array(z.string()).optional(),
  _blocked: z.number().optional(),
  _stage: opt(z.string()),
  _nextPublishAt: opt(z.string()),
});

export const publicationSchema = z.looseObject({
  ...base,
  contentId: z.string(),
  platform: z.enum(PLATFORMS),
  status: z.enum(['planned', 'scheduled', 'published', 'failed', 'cancelled']),
  scheduledAt: opt(iso),
  publishedAt: opt(iso),
  url: opt(z.string().max(4000)),
  externalId: opt(z.string().max(200)),
});

export const snapshotSchema = z.looseObject({
  ...base,
  publicationId: z.string(),
  contentId: z.string(),
  platform: z.enum(PLATFORMS),
  observedAt: iso,
  ageHours: z.number(),
  checkpoint: z.enum(['1h', '6h', '24h', '72h', '7d', '28d']).nullish(),
  source: z.enum(['manual', 'csv', 'api']),
  metrics: z.record(z.string(), z.number().finite()),
});

export const taskSchema = z.looseObject({
  ...base,
  title: z.string().min(1).max(500),
  status: z.enum(['todo', 'doing', 'done']),
  kind: z.enum(['task', 'decision']),
  isBlocker: z.boolean(),
  blockerType: z.enum(['reference', 'asset', 'decision', 'generation', 'external', 'other']).nullish(),
  priority,
  dueAt: opt(iso),
  hardDeadline: z.boolean().optional(),
  estimateMin: opt(z.number().min(0).max(100000)),
  projectId: opt(z.string()),
  contentId: opt(z.string()),
  ideaId: opt(z.string()),
  libraryId: opt(z.string()),
  options: z.array(z.string().max(300)).max(10).optional(),
  resolution: opt(z.string().max(5000)),
  doneAt: opt(iso),
  notes: opt(z.string().max(20000)),
});

export const eventSchema = z.looseObject({
  ...base,
  title: z.string().min(1).max(300),
  kind: z.enum(['production_block', 'milestone', 'deadline', 'external']),
  startAt: iso,
  endAt: opt(iso),
  allDay: z.boolean(),
  projectId: opt(z.string()),
  contentId: opt(z.string()),
  notes: opt(z.string().max(5000)),
});

export const LIBRARY_KINDS = [
  'link',
  'image',
  'video',
  'audio',
  'voice',
  'note',
  'style',
  'location',
  'character_ref',
  'clip',
  'cover',
  'export',
  'trend',
  'news',
  'post',
  'account',
  'technique',
  'file',
  'other',
] as const;

export const librarySchema = z.looseObject({
  ...base,
  title: opt(z.string().max(500)),
  role: z.enum(['inspiration', 'reference', 'asset']),
  kind: z.enum(LIBRARY_KINDS),
  originalUrl: opt(z.string().max(4000)),
  canonicalUrl: opt(z.string().max(4000)),
  site: opt(z.string().max(200)),
  platformRef: z
    .object({ platform: z.string(), externalId: z.string().optional(), handle: z.string().optional() })
    .nullish(),
  author: opt(z.string().max(200)),
  sourceDate: opt(iso),
  thumbUrl: opt(z.string().max(4000)),
  mediaId: opt(z.string()),
  notes: opt(z.string().max(50000)),
  whyRelevant: opt(z.string().max(5000)),
  projectId: opt(z.string()),
  expiresAt: opt(iso),
  tags,
});

export const mediaSchema = z.looseObject({
  ...base,
  name: opt(z.string().max(300)),
  mime: z.string().max(100),
  bytes: z.number().int().min(0),
  sha256: z.string(),
  width: opt(z.number()),
  height: opt(z.number()),
  durationSec: opt(z.number()),
  driveFileId: opt(z.string()),
  externalUrl: opt(z.string().max(4000)),
  altText: opt(z.string().max(1000)),
  hasThumb: z.boolean().optional(),
});

export const learningSchema = z.looseObject({
  ...base,
  statement: z.string().min(1).max(2000),
  kind: z.enum(['observation', 'hypothesis', 'conclusion']),
  confidence: z.enum(['low', 'medium', 'high']),
  status: z.enum(['active', 'retired']),
  scope: z
    .object({
      platforms: z.array(z.enum(PLATFORMS)).optional(),
      formats: z.array(z.string()).optional(),
      projectId: opt(z.string()),
    })
    .optional(),
  evidenceNote: opt(z.string().max(20000)),
  metricsSummary: z.object({ metric: z.string(), n: z.number(), effect: z.string().optional() }).nullish(),
  lastValidatedAt: opt(iso),
  tags,
});

export const LINK_TYPES = ['references', 'inspired', 'evidence', 'influenced', 'related'] as const;
export const linkSchema = z.looseObject({
  ...base,
  fromType: z.string(),
  fromId: z.string(),
  toType: z.string(),
  toId: z.string(),
  type: z.enum(LINK_TYPES),
  note: opt(z.string().max(1000)),
});

export const tombstoneSchema = z.object({
  id: z.string(),
  entity: z.string(),
  deletedAt: iso,
  rev: z.string(),
});

export const ENTITY_SCHEMAS = {
  workspace: workspaceSchema,
  projects: projectSchema,
  ideas: ideaSchema,
  captures: captureSchema,
  content: contentSchema,
  publications: publicationSchema,
  snapshots: snapshotSchema,
  tasks: taskSchema,
  events: eventSchema,
  library: librarySchema,
  media: mediaSchema,
  learnings: learningSchema,
  links: linkSchema,
} as const;

/** The ONLY tables that leave the device (sync journal, snapshots, backups, exports). */
export type EntityTable = keyof typeof ENTITY_SCHEMAS;
export const SYNC_TABLES = Object.keys(ENTITY_SCHEMAS) as EntityTable[];

export type Workspace = z.infer<typeof workspaceSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Idea = z.infer<typeof ideaSchema>;
export type Capture = z.infer<typeof captureSchema>;
export type Content = z.infer<typeof contentSchema>;
export type Publication = z.infer<typeof publicationSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Task = z.infer<typeof taskSchema>;
export type HQEvent = z.infer<typeof eventSchema>;
export type LibraryItem = z.infer<typeof librarySchema>;
export type MediaMeta = z.infer<typeof mediaSchema>;
export type Learning = z.infer<typeof learningSchema>;
export type Link = z.infer<typeof linkSchema>;
export type Tombstone = z.infer<typeof tombstoneSchema>;

export interface EntityMap {
  workspace: Workspace;
  projects: Project;
  ideas: Idea;
  captures: Capture;
  content: Content;
  publications: Publication;
  snapshots: Snapshot;
  tasks: Task;
  events: HQEvent;
  library: LibraryItem;
  media: MediaMeta;
  learnings: Learning;
  links: Link;
}
export type AnyRecord = EntityMap[EntityTable];

/** Fields that are metadata, not user data — never stamped as user field changes. */
export const META_FIELDS = new Set([
  'id',
  'workspaceId',
  'schemaVersion',
  'createdAt',
  'updatedAt',
  'updatedByDevice',
  'rev',
  'fieldRevs',
  'fieldPrev',
]);

/** Long-form text: concurrent edits keep a conflict copy instead of silently losing one side. */
export const LONG_TEXT_FIELDS = new Set([
  'raw',
  'concept',
  'script',
  'notes',
  'brief',
  'productionNotes',
  'editNotes',
  'caption',
  'evidenceNote',
  'whyItWorks',
  'text',
  'statement',
  'resolution',
]);

export function isDerivedField(k: string): boolean {
  return k.startsWith('_');
}
