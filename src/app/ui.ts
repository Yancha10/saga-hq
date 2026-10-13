import { createStore } from './status';

export interface CapturePreset {
  text?: string;
  mode?: 'text' | 'task' | 'link';
}
export const captureState = createStore<CapturePreset | null>(null);
export const paletteState = createStore(false);
export const secretaryState = createStore<{
  open: boolean;
  focus?: { entity: 'content' | 'idea' | 'project'; id: string };
  intent?: string;
}>({ open: false });
