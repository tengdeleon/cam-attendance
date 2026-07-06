// Calls FastAPI: GET /reports/history (JSON) and /reports/history.csv.
import { api, apiText } from './apiClient';
import type { HistoryRow } from '../types';

/** start/end are Manila-local dates, 'yyyy-mm-dd', inclusive. */
export const getHistory = (start: string, end: string) =>
  api<HistoryRow[]>(`/reports/history?start=${start}&end=${end}`);

/** CSV text for the same range (backend renders Manila-local times). */
export const getHistoryCsv = (start: string, end: string) =>
  apiText(`/reports/history.csv?start=${start}&end=${end}`);
