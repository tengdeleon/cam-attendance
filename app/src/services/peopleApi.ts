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
