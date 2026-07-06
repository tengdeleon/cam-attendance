// Calls FastAPI: GET/POST/PATCH/DELETE /people.
import { api } from './apiClient';
import type { Person, Role } from '../types';

export interface PersonInput {
  full_name: string;
  role: Role;
  photo_url?: string | null;
}

export const listPeople = () => api<Person[]>('/people');

export const createPerson = (body: PersonInput) =>
  api<Person>('/people', { method: 'POST', body: JSON.stringify(body) });

export const updatePerson = (id: string, body: PersonInput) =>
  api<Person>(`/people/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deactivatePerson = (id: string) =>
  api<void>(`/people/${id}`, { method: 'DELETE' });

/** RA 10173 deletion request: permanently removes the person, their
 * attendance rows, and every selfie. Irreversible. */
export const erasePerson = (id: string) =>
  api<{ selfies_removed: number; attendance_deleted: number }>(`/admin/people/${id}`, {
    method: 'DELETE',
  });
