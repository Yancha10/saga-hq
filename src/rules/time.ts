export const HOUR = 3600_000;
export const DAY = 86400_000;

export function startOfDay(t: number | Date): Date {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}
export function endOfDay(t: number | Date): Date {
  const d = new Date(t);
  d.setHours(23, 59, 59, 999);
  return d;
}
export function addDays(t: number | Date, n: number): Date {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d;
}
export function sameDay(a: string | Date | number, b: string | Date | number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
export function startOfWeek(t: number | Date): Date {
  const d = startOfDay(t);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return d;
}
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
export function fmtDay(iso: string | Date, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Date(iso).toLocaleDateString(undefined, opts);
}
export function relDays(iso: string, now = Date.now()): string {
  const d = Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(now).getTime()) / DAY);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  if (d < 0) return `${-d}d ago`;
  return `in ${d}d`;
}
/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
export function toDateInput(iso: string | null | undefined): string {
  return iso ? toLocalInput(iso).slice(0, 10) : '';
}
