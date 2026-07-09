// Calls FastAPI: GET /reports/history (JSON) and /reports/history.csv.
import { api, apiText } from './apiClient';
import type { HistoryRow } from '../types';

/** start/end are Manila-local dates, 'yyyy-mm-dd', inclusive. */
export const getHistory = (start: string, end: string) =>
  api<HistoryRow[]>(`/reports/history?start=${start}&end=${end}`);

/** CSV text for the same range (backend renders Manila-local times). */
export const getHistoryCsv = (start: string, end: string) =>
  apiText(`/reports/history.csv?start=${start}&end=${end}`);

export interface DailyDetail {
  date: string;
  first_in: string;
  late_minutes: number;
  missed_checkout: boolean;
}

export interface PeriodReportRow {
  person_id: string;
  full_name: string;
  days_present: number;
  late_days: number;
  total_late_minutes: number;
  missed_checkouts: number;
  daily_detail: DailyDetail[];
}

export const getPeriodReport = (month: string, period: string) =>
  api<PeriodReportRow[]>(
    `/reports/period?month=${encodeURIComponent(month)}&period=${encodeURIComponent(period)}`
  );

export const getPeriodReportCsv = (month: string, period: string) =>
  apiText(
    `/reports/period.csv?month=${encodeURIComponent(month)}&period=${encodeURIComponent(period)}`
  );
