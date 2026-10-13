import type { FormatTemplate } from './schema';

export const DEFAULT_TEMPLATES: FormatTemplate[] = [
  {
    id: 'reel',
    name: 'Short video (Reel / TikTok / Short)',
    ratio: '9:16',
    defaultDurationSec: 20,
    platforms: ['instagram', 'tiktok', 'youtube_shorts'],
    sections: ['concept', 'references', 'generate', 'edit', 'package', 'publish'],
    required: ['hook', 'script', 'finalExport', 'cover', 'caption', 'publishDate'],
  },
  {
    id: 'youtube_long',
    name: 'YouTube video',
    ratio: '16:9',
    platforms: ['youtube'],
    sections: ['concept', 'references', 'generate', 'edit', 'package', 'publish'],
    required: ['hook', 'script', 'finalExport', 'cover', 'coverText', 'caption', 'publishDate'],
  },
  {
    id: 'carousel',
    name: 'Carousel',
    ratio: '4:5',
    platforms: ['instagram', 'tiktok'],
    sections: ['concept', 'references', 'generate', 'package', 'publish'],
    required: ['hook', 'finalExport', 'caption', 'publishDate'],
  },
  {
    id: 'image_post',
    name: 'Image post',
    ratio: '4:5',
    platforms: ['instagram', 'x'],
    sections: ['concept', 'references', 'generate', 'package', 'publish'],
    required: ['finalExport', 'caption', 'publishDate'],
  },
  {
    id: 'story',
    name: 'Story',
    ratio: '9:16',
    platforms: ['instagram'],
    sections: ['concept', 'generate', 'publish'],
    required: ['finalExport', 'publishDate'],
  },
];

export const PROJECT_COLORS = 8;
