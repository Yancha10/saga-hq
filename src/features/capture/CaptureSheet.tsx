import { useNavigate } from '@tanstack/react-router';
import { Camera, CheckSquare, FileUp, Link2, Mic, Square, Type } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../app/context';
import { toast } from '../../app/status';
import type { CapturePreset } from '../../app/ui';
import { capture } from '../../data/domain';
import { addMedia, MediaTooLargeError } from '../../media/store';
import { Button, Chip, Sheet } from '../../ui/kit';
import { ProjectSelect } from '../common';

type Mode = 'text' | 'task' | 'link' | 'photo' | 'voice' | 'file';

/** Capture in seconds: nothing is required, nothing is classified at capture time. */
export function CaptureSheet({
  open,
  preset,
  onClose,
}: {
  open: boolean;
  preset?: CapturePreset;
  onClose: () => void;
}) {
  const s = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [showProject, setShowProject] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setMode((preset?.mode as Mode) ?? 'text');
      setText(preset?.text ?? '');
      setFiles([]);
      setProjectId(null);
      setShowProject(false);
      setTimeout(() => textRef.current?.focus(), 30);
    } else stopRecording(true);
  }, [open]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('Voice recording is not supported in this browser. Type instead, or attach an audio file.', {
        kind: 'error',
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        for (const t of stream.getTracks()) t.stop();
        if (chunks.current.length) {
          const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
          setFiles((f) => [
            ...f,
            new File(
              [blob],
              `voice-${new Date().toISOString().slice(0, 16)}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`,
              { type: blob.type },
            ),
          ]);
        }
      };
      rec.start(1000); // chunked so a crash keeps most of the recording
      recRef.current = rec;
      setSeconds(0);
      setRecording(true);
    } catch {
      toast('Microphone permission was denied. You can still type the idea.', { kind: 'error' });
    }
  };
  const stopRecording = (discard = false) => {
    const rec = recRef.current;
    if (!rec) return;
    if (discard) chunks.current = [];
    if (rec.state !== 'inactive') rec.stop();
    recRef.current = null;
    setRecording(false);
  };

  const save = async () => {
    if (recording) stopRecording();
    await new Promise((r) => setTimeout(r, recording ? 200 : 0));
    if (!text.trim() && files.length === 0 && chunks.current.length === 0) {
      textRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const mediaIds: string[] = [];
      for (const f of files) {
        try {
          mediaIds.push((await addMedia(s, f, f.name)).id);
        } catch (e) {
          if (e instanceof MediaTooLargeError) toast(e.message, { kind: 'error' });
          else throw e;
        }
      }
      const m =
        mode === 'photo' || mode === 'file'
          ? 'photo'
          : mode === 'voice'
            ? 'voice'
            : mode === 'task'
              ? 'task'
              : mode === 'link'
                ? 'link'
                : 'text';
      const kind = files.some((f) => f.type.startsWith('video/'))
        ? 'video'
        : files.length && !files[0]!.type.startsWith('image/') && !files[0]!.type.startsWith('audio/')
          ? 'file'
          : m;
      const c = await capture(s, { text, mode: kind as never, mediaIds, projectId });
      toast('Saved to Inbox', {
        kind: 'success',
        action: { label: 'Open Inbox', run: () => void navigate({ to: '/inbox', search: { focus: c.id } }) },
      });
      onClose();
    } catch {
      /* persistence errors are surfaced by the global banner */
    } finally {
      setSaving(false);
    }
  };

  const modes: { m: Mode; label: string; icon: typeof Type }[] = [
    { m: 'text', label: 'Text', icon: Type },
    { m: 'task', label: 'Task', icon: CheckSquare },
    { m: 'link', label: 'Link', icon: Link2 },
    { m: 'photo', label: 'Photo', icon: Camera },
    { m: 'voice', label: 'Voice', icon: Mic },
    { m: 'file', label: 'File', icon: FileUp },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Capture"
      footer={
        <>
          <span className="meta hide-mobile" style={{ marginRight: 'auto' }}>
            ⌘↵ to save · saved to Inbox, sort it later
          </span>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="chips" role="group" aria-label="Capture type">
        {modes.map(({ m, label, icon: Icon }) => (
          <Chip
            key={m}
            on={mode === m}
            onClick={() => {
              setMode(m);
              if (m === 'photo') photoRef.current?.click();
              if (m === 'file') fileRef.current?.click();
              if (m === 'voice' && !recording) void startRecording();
              if (m === 'link')
                void navigator.clipboard
                  ?.readText?.()
                  .then((t) => /^https?:\/\//.test(t.trim()) && !text && setText(t.trim()))
                  .catch(() => {});
            }}
          >
            <Icon size={14} aria-hidden /> {label}
          </Chip>
        ))}
      </div>
      <textarea
        ref={textRef}
        className="textarea"
        rows={4}
        aria-label="What's on your mind?"
        placeholder={
          mode === 'task'
            ? 'What needs doing?'
            : mode === 'link'
              ? 'Paste a link (and why it matters)…'
              : 'What’s on your mind?'
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        onPaste={(e) => {
          const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
          if (imgs.length) {
            setFiles((f) => [...f, ...imgs]);
            setMode('photo');
          }
        }}
      />
      {recording && (
        <div className="hstack" role="status">
          <span className="status-dot err" aria-hidden /> Recording {seconds}s
          <Button size="sm" onClick={() => stopRecording()}>
            <Square size={12} /> Stop
          </Button>
        </div>
      )}
      {files.length > 0 && (
        <div className="chips">
          {files.map((f, i) => (
            <span key={`${f.name}:${f.size}:${f.lastModified}`} className="tag">
              {f.name.slice(0, 32)} · {(f.size / 1024 / 1024).toFixed(1)} MB
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}
                style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer' }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])}
      />
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])}
      />
      {showProject ? (
        <div className="field">
          <span className="lbl">Project (optional)</span>
          <ProjectSelect value={projectId} onChange={setProjectId} />
        </div>
      ) : (
        <button
          type="button"
          className="btn ghost sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setShowProject(true)}
        >
          + Project (optional)
        </button>
      )}
    </Sheet>
  );
}
