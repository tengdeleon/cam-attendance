// Asia/Manila formatting helpers.
// Server stores UTC; every user-facing time is rendered in Manila.

const TZ = 'Asia/Manila';

/** '3:42 PM' in Manila. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** 'Mon, Jul 6, 3:42 PM' in Manila. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    timeZone: TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** 'Mon, Jul 6' for a yyyy-mm-dd date string. */
export function formatDateLabel(ymd: string): string {
  return new Date(`${ymd}T00:00:00+08:00`).toLocaleDateString('en-PH', {
    timeZone: TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** 'yyyy-mm-dd' in Manila for an arbitrary Date. */
export function manilaYmd(d: Date): string {
  // en-CA locale formats as yyyy-mm-dd
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Today's date in Manila as 'yyyy-mm-dd' (what the API expects). */
export function todayManila(): string {
  return manilaYmd(new Date());
}

/** Shift a 'yyyy-mm-dd' string by n days. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return manilaYmd(d);
}

/** Manila-local date ('yyyy-mm-dd') of a UTC ISO timestamp — for grouping. */
export function manilaDateOf(iso: string): string {
  return manilaYmd(new Date(iso));
}
