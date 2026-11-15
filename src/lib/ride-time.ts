export const DAY_MS = 86400000;
export const IST_OFFSET_MS = 330 * 60000;

export function calendarDate(value: string): string | null {
  let text = value.trim();
  const indian = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text);
  if (indian) text = `${indian[3]}-${indian[2]}-${indian[1]}`;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match || Number(match[1]) < 1900 || Number(match[1]) > 9999) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}

export function timestamp(value: string): number {
  const date = calendarDate(value);
  if (date) return Date.parse(`${date}T00:00:00+05:30`);
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return NaN;
  if (!calendarDate(value.slice(0, 10))) return NaN;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.slice(11, 16))) return NaN;
  const seconds = /[T ]\d{2}:\d{2}:(\d{2})/.exec(value);
  if (seconds && Number(seconds[1]) > 59) return NaN;
  const normalized = value.replace(" ", "T");
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}+05:30`);
}
export function localDate(time: number): string { return new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10); }
export function localTimestamp(time: number): string { return `${new Date(time + IST_OFFSET_MS).toISOString().slice(0, 19)}+05:30`; }
export function idleWindow(date: string, start: string, end: string) {
  const from = timestamp(`${calendarDate(date)}T${start}`);
  let to = timestamp(`${calendarDate(date)}T${end}`);
  if (to <= from) to += DAY_MS;
  return { start: from, end: to };
}
export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}
