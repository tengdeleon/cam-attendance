// Calls FastAPI: POST /attendance (multipart selfie), GET /attendance/today, GET /attendance/{id}/selfie.
import { api } from './apiClient';
import type { AttendanceRecord, Direction, SelfieUrlResponse, TodayRow } from '../types';

export interface LogAttendanceInput {
  personId: string;
  direction: Direction;
  selfieUri: string; // local file uri of the (compressed) jpeg
  deviceTime?: string; // ISO; set by queue replays to keep the original capture time
}

export function logAttendance({ personId, direction, selfieUri, deviceTime }: LogAttendanceInput) {
  const form = new FormData();
  form.append('person_id', personId);
  form.append('direction', direction);
  form.append('device_time', deviceTime ?? new Date().toISOString());
  form.append('selfie', {
    uri: selfieUri,
    name: 'selfie.jpg',
    type: 'image/jpeg',
  } as any); // React Native FormData file shape

  return api<AttendanceRecord>('/attendance', { method: 'POST', body: form });
}

export const getToday = () => api<TodayRow[]>('/attendance/today');

export const getSelfieUrl = (attendanceId: string): Promise<SelfieUrlResponse> =>
  api<SelfieUrlResponse>(`/attendance/${attendanceId}/selfie`);
