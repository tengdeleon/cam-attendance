// Shared types — mirror backend/api/app/models/schemas.py

export type Role = 'teacher' | 'student';
export type Direction = 'in' | 'out';

export interface Person {
  id: string;
  full_name: string;
  role: Role;
  photo_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface TeacherAccount {
  id: string;
  person_id: string;
  is_admin: boolean;
}

export interface AttendanceRecord {
  id: string;
  person_id: string;
  direction: Direction;
  logged_by: string;
  server_time: string;
}

export interface TodayRow {
  person_id: string;
  full_name: string;
  role: Role;
  last_direction: Direction;
  last_time: string;
  last_attendance_id: string;
}

export interface SelfieUrlResponse {
  url: string;
  expires_in: number;
}

export interface HistoryRow {
  id: string;
  person_id: string;
  full_name: string;
  role: Role;
  direction: Direction;
  server_time: string;
}
