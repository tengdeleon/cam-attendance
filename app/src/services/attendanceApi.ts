// Calls FastAPI: POST /attendance (multipart selfie), GET /attendance/today.
import { api } from './apiClient';
import type { AttendanceRecord, Direction, TodayRow } from '../types';

export interface LogAttendanceInput {
  personId: string;
  direction: Direction;
  selfieUri: string; // local file uri of the (compressed) jpeg
}

export function logAttendance({ personId, direction, selfieUri }: LogAttendanceInput) {
  const form = new FormData();
  form.append('person_id', personId);
  form.append('direction', direction);
  form.append('device_time', new Date().toISOString());
  form.append('selfie', {
    uri: selfieUri,
    name: 'selfie.jpg',
    type: 'image/jpeg',
  } as any); // React Native FormData file shape

  return api<AttendanceRecord>('/attendance', { method: 'POST', body: form });
}

export const getToday = () => api<TodayRow[]>('/attendance/today');
