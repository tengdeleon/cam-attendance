// Calls FastAPI: GET /reports/history (JSON) and /reports/history.csv (Phase 8).
import { api } from './apiClient';
import type { HistoryRow } from '../types';

/** start/end are Manila-local dates, 'yyyy-mm-dd', inclusive. */
export const getHistory = (start: string, end: string) =>
  api<HistoryRow[]>(`/reports/history?start=${start}&end=${end}`);
