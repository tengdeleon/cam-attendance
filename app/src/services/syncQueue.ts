// Offline queue (expo-sqlite). Stores pending check-ins (incl. selfie file)
// and replays them against the FastAPI /attendance endpoint when online.
//
// Design:
// - The selfie is COPIED into documentDirectory/queue/ (camera cache files
//   can be evicted by the OS before we get to sync).
// - flush() replays oldest-first. A network failure stops the flush (rest
//   stays queued); a 4xx from the API drops the item (retrying can't fix it).
// - After a successful replay the local file is deleted immediately —
//   selfies must not linger on the device (PROJECT_INSTRUCTIONS §9).
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { logAttendance } from './attendanceApi';
import { ApiError } from './apiClient';
import type { Direction } from '../types';

export interface PendingItem {
  id: string;
  person_id: string;
  person_name: string;
  direction: Direction;
  device_time: string; // ISO, original capture time
  selfie_path: string; // file:// uri inside documentDirectory/queue/
  created_at: string;
}

const QUEUE_DIR = `${FileSystem.documentDirectory}queue/`;

const db = SQLite.openDatabaseSync('cam.db');
db.execSync(`
  CREATE TABLE IF NOT EXISTS pending_attendance (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    person_name TEXT NOT NULL,
    direction TEXT NOT NULL,
    device_time TEXT NOT NULL,
    selfie_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

async function ensureQueueDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(QUEUE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(QUEUE_DIR, { intermediates: true });
  }
}

/** Save a failed check-in locally. Returns the queued item. */
export async function enqueue(input: {
  personId: string;
  personName: string;
  direction: Direction;
  selfieUri: string;
}): Promise<PendingItem> {
  await ensureQueueDir();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dest = `${QUEUE_DIR}${id}.jpg`;
  await FileSystem.copyAsync({ from: input.selfieUri, to: dest });

  const item: PendingItem = {
    id,
    person_id: input.personId,
    person_name: input.personName,
    direction: input.direction,
    device_time: new Date().toISOString(),
    selfie_path: dest,
    created_at: new Date().toISOString(),
  };
  db.runSync(
    `INSERT INTO pending_attendance (id, person_id, person_name, direction, device_time, selfie_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [item.id, item.person_id, item.person_name, item.direction, item.device_time, item.selfie_path, item.created_at]
  );
  return item;
}

export function listPending(): PendingItem[] {
  return db.getAllSync<PendingItem>(
    'SELECT * FROM pending_attendance ORDER BY created_at ASC'
  );
}

export function pendingCount(): number {
  const row = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM pending_attendance');
  return row?.n ?? 0;
}

async function remove(item: PendingItem): Promise<void> {
  db.runSync('DELETE FROM pending_attendance WHERE id = ?', [item.id]);
  await FileSystem.deleteAsync(item.selfie_path, { idempotent: true });
}

export interface FlushResult {
  synced: number;
  dropped: number; // rejected by the API (4xx) — not retryable
  remaining: number;
}

let flushing = false;

/** Replay pending items oldest-first. Safe to call repeatedly. */
export async function flush(): Promise<FlushResult> {
  if (flushing) return { synced: 0, dropped: 0, remaining: pendingCount() };
  flushing = true;
  let synced = 0;
  let dropped = 0;
  try {
    for (const item of listPending()) {
      try {
        await logAttendance({
          personId: item.person_id,
          direction: item.direction,
          selfieUri: item.selfie_path,
          deviceTime: item.device_time,
        });
        await remove(item);
        synced++;
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          // Server understood and rejected (e.g. person deactivated) — drop it.
          await remove(item);
          dropped++;
        } else {
          // Network / server error: stop, keep this and the rest queued.
          break;
        }
      }
    }
  } finally {
    flushing = false;
  }
  return { synced, dropped, remaining: pendingCount() };
}
