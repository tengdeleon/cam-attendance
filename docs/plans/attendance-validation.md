# Attendance Validation + Missed-Checkout Reports

Status: planning  
Date: 2026-07-08  
Branch target: feat/attendance-validation (branch from main after contracts are agreed)

---

## Goal

Harden `POST /attendance` with server-side duplicate-state guards (R1–R3), surface
missed-checkout warnings to the teacher immediately after a successful check-in, make
the sync-queue's silent 4xx drops visible, and deliver the bi-monthly period report
(extending Phase 11 Track A.1–A.4) with a `missed_checkouts` column plus the
`center_settings` admin endpoints required by the lateness model.

---

## Section 1 — API Contracts

All contracts below are fixed before any implementation work starts. Both teams (backend
and mobile) build to these definitions. No field or error shape may change without a
contract revision that updates this document first.

### 1.1 Extended `AttendanceOut` schema

`POST /attendance` 201 response body:

```json
{
  "id": "uuid",
  "person_id": "uuid",
  "direction": "in | out",
  "logged_by": "uuid",
  "server_time": "2026-07-08T10:34:00+00:00",
  "warnings": []
}
```

`warnings` is always present (never omitted, never null). It is an empty array on the
common case. Each element has the shape:

```json
{
  "code": "missed_checkout",
  "date": "YYYY-MM-DD"
}
```

`date` is the Manila-local date of the unclosed prior-day check-in (e.g. `"2026-07-07"`).
Multiple missed days produce multiple elements. The array is ordered oldest date first.

### 1.2 Extended 409 error body

Both R1 and R2 rejections use HTTP 409. FastAPI's `HTTPException` already serialises to
`{"detail": "..."}`. Extend every 409 raised in `record_attendance` to also carry `code`:

```json
{
  "detail": "Already checked in",
  "code": "already_checked_in"
}
```

```json
{
  "detail": "Not checked in",
  "code": "not_checked_in"
}
```

The client reads `code` (not `detail`) for branching logic. `detail` is the human-readable
string shown in the UI.

Implementation note: FastAPI's `HTTPException` accepts an arbitrary dict as `detail`. Use
`detail={"detail": "...", "code": "..."}` so the serialised body matches the shape above.
The `ApiError` class on the client currently reads `body.detail` as a string — the
client-side change (Section 3, step C-2) must handle the case where `body.detail` is a
dict.

### 1.3 `PeriodReportRow` — JSON shape for `GET /reports/period`

```json
{
  "person_id": "uuid",
  "full_name": "string",
  "days_present": 12,
  "late_days": 3,
  "total_late_minutes": 47,
  "missed_checkouts": 2,
  "daily_detail": [
    {
      "date": "2026-07-01",
      "first_in": "08:23:00",
      "late_minutes": 23,
      "missed_checkout": false
    }
  ]
}
```

- `missed_checkouts` — count of Manila-local days in the period where the person had a
  check-in with no subsequent check-out (i.e. the day's last direction was `in`).
- `daily_detail` includes every day the person had at least one check-in. `missed_checkout`
  is `true` on rows where no check-out was recorded that day. `late_minutes` is 0 on
  non-late days; it measures minutes from `open_time` (not from end of grace) per spec A.2.
- `first_in` is the Manila-local wall-clock time string, `HH:MM:SS`, for the earliest
  check-in that day.

Response is an array of `PeriodReportRow`, one element per teacher with at least one
check-in event in the period.

### 1.4 Query parameters for `/reports/period` and `/reports/period.csv`

| Parameter | Type | Required | Values | Notes |
|---|---|---|---|---|
| `month` | string | yes | `YYYY-MM` | e.g. `2026-07` |
| `period` | string | yes | `h1`, `h2`, `full` | h1=days 1–15; h2=days 16–EOM; full=whole month |

HTTP 422 if either parameter is missing or `period` is not one of the three values.

### 1.5 CSV column order for `/reports/period.csv`

```
teacher_name,period,days_present,late_days,total_late_minutes,missed_checkouts
```

One row per teacher. The `period` column contains the human-readable label:
`"H1 YYYY-MM"`, `"H2 YYYY-MM"`, or `"Full YYYY-MM"`. No per-day detail rows in the
CSV (summary only). Filename: `period_report_<month>_<period>.csv`.

Response headers:
```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="period_report_2026-07_h1.csv"
```

### 1.6 `CenterSettings` schema

GET `/admin/center-settings` 200 response and PATCH `/admin/center-settings` request/response:

```json
{
  "open_time": "08:00:00",
  "grace_minutes": 10,
  "tz": "Asia/Manila"
}
```

- `open_time` — string in `HH:MM:SS` format (Postgres `time` type).
- `grace_minutes` — positive integer.
- `tz` — IANA timezone string. In v1 this is always `"Asia/Manila"`; the field is
  returned to allow future configuration without a schema change.

PATCH accepts any subset of the three fields (partial update). Unknown fields are
ignored (Pydantic `model_config = ConfigDict(extra='ignore')`). Returns the full
settings object after update. HTTP 422 if a provided value fails validation (e.g.
`grace_minutes` < 0, `open_time` not parseable as `HH:MM:SS`).

### 1.7 HTTP error codes for new endpoints

| Endpoint | Condition | Status |
|---|---|---|
| POST /attendance | Already checked in (R1) | 409 + `code: already_checked_in` |
| POST /attendance | Not checked in (R2) | 409 + `code: not_checked_in` |
| GET /reports/period | Missing/invalid `month` or `period` | 422 |
| GET /reports/period | Unauthenticated | 401 |
| GET /reports/period | Authenticated but not teacher | 403 |
| GET /reports/period.csv | Same as above | 422 / 401 / 403 |
| GET /admin/center-settings | Not admin | 403 |
| PATCH /admin/center-settings | Not admin | 403 |
| PATCH /admin/center-settings | Invalid field value | 422 |

---

## Section 2 — Backend Steps

### B-1: Migration `0002_reports.sql`

File to create: `backend/supabase/migrations/0002_reports.sql`

Content outline (additive only — no DROP, no ALTER COLUMN rename, no existing index
removal):

```sql
-- 1. center_settings singleton (from phase-11-plan.md A.2 spec)
create table if not exists center_settings (
  id            int primary key default 1 check (id = 1),
  open_time     time not null default '08:00',
  grace_minutes int  not null default 10,
  tz            text not null default 'Asia/Manila'
);
insert into center_settings (id) values (1) on conflict do nothing;

-- 2. RLS on center_settings
alter table center_settings enable row level security;
-- any authenticated teacher can read
create policy cs_select on center_settings for select using (is_teacher());
-- only admins may update
create policy cs_update on center_settings for update using (is_admin());

-- 3. Helper view for daily first-in (from phase-11-plan.md A.3 spec)
--    Uses hard-coded 'Asia/Manila' as a convenience; service overrides at query time.
create or replace view v_daily_first_in as
select person_id,
       (server_time at time zone 'Asia/Manila')::date as local_day,
       min(server_time at time zone 'Asia/Manila')    as first_in_local
from attendance
where direction = 'in'
group by person_id, local_day;

-- 4. Helper view for daily last direction (needed for missed_checkout count)
create or replace view v_daily_last_direction as
select person_id,
       (server_time at time zone 'Asia/Manila')::date as local_day,
       (array_agg(direction order by server_time desc))[1] as last_direction
from attendance
group by person_id, local_day;

-- 5. Index to support the today-bound queries added by R1/R2
--    idx_attendance_server_time already exists from 0001_init.sql.
--    Add a composite covering (person_id, server_time) for the validation queries.
create index if not exists idx_attendance_person_time
  on attendance(person_id, server_time);
```

Additive-only verification: the file must be reviewed to confirm it contains no `DROP`,
`DELETE`, `TRUNCATE`, `ALTER TABLE ... DROP COLUMN`, or `ALTER TABLE ... RENAME COLUMN`
statements before merging.

Rollback note: Supabase migrations are not transactional DDL on all engines. If a
partial apply occurs, manually drop the objects created in reverse order
(`v_daily_last_direction`, `v_daily_first_in`, the RLS policies, `center_settings`).
Document the exact reverse steps in a comment block at the bottom of the migration file.

### B-2: Pydantic schema additions

File: `backend/api/app/models/schemas.py`

Add:

```python
class AttendanceWarning(BaseModel):
    code: Literal["missed_checkout"]
    date: str  # Manila-local date, YYYY-MM-DD

class AttendanceOut(BaseModel):
    id: str
    person_id: str
    direction: Literal["in", "out"]
    logged_by: str
    server_time: datetime
    warnings: list[AttendanceWarning] = []

class DailyDetail(BaseModel):
    date: str            # YYYY-MM-DD
    first_in: str        # HH:MM:SS Manila-local
    late_minutes: int
    missed_checkout: bool

class PeriodReportRow(BaseModel):
    person_id: str
    full_name: str
    days_present: int
    late_days: int
    total_late_minutes: int
    missed_checkouts: int
    daily_detail: list[DailyDetail]

class CenterSettingsOut(BaseModel):
    open_time: str        # HH:MM:SS
    grace_minutes: int
    tz: str

class CenterSettingsPatch(BaseModel):
    model_config = ConfigDict(extra='ignore')
    open_time: Optional[str] = None
    grace_minutes: Optional[int] = None
    tz: Optional[str] = None
```

`AttendanceOut` already exists in `schemas.py` without `warnings`. Replace the class
definition (add `warnings` field with default `[]`). All other additions are new classes.

### B-3: Validation logic in `record_attendance`

File: `backend/api/app/services/attendance_service.py`

After the selfie/person guard and before the insert, add two blocks:

**R1 — duplicate check-in guard:**

```python
today_mnl = datetime.now(MANILA).date()
lo, hi = manila_day_bounds(today_mnl, today_mnl)
existing = (
    sb.table("attendance")
    .select("id, direction")
    .eq("person_id", payload.person_id)
    .gte("server_time", lo)
    .lt("server_time", hi)
    .order("server_time", desc=True)
    .limit(1)
    .execute()
)
latest_today = existing.data[0] if existing.data else None

if payload.direction == "in" and latest_today and latest_today["direction"] == "in":
    raise HTTPException(
        status.HTTP_409_CONFLICT,
        detail={"detail": "Already checked in", "code": "already_checked_in"},
    )
if payload.direction == "out" and (not latest_today or latest_today["direction"] == "out"):
    raise HTTPException(
        status.HTTP_409_CONFLICT,
        detail={"detail": "Not checked in", "code": "not_checked_in"},
    )
```

**R3 — missed-checkout warning detection (check-in path only):**

After the R1/R2 block, if `payload.direction == "in"`, query prior days:

```python
warnings = []
if payload.direction == "in":
    # Find the most recent prior-day event for this person
    prior = (
        sb.table("attendance")
        .select("id, direction, server_time")
        .eq("person_id", payload.person_id)
        .lt("server_time", lo)   # strictly before today's Manila window
        .order("server_time", desc=True)
        .limit(1)
        .execute()
    )
    if prior.data:
        last_prior = prior.data[0]
        if last_prior["direction"] == "in":
            # The last event on a prior day was a check-in with no checkout.
            # Find all prior days with this pattern (oldest first).
            missed = _find_missed_checkout_days(sb, payload.person_id, lo)
            warnings = [{"code": "missed_checkout", "date": d} for d in missed]
```

`_find_missed_checkout_days(sb, person_id, before_utc)` is a private helper added to
the same file. It queries `v_daily_last_direction` where `local_day < today_mnl` and
`last_direction = 'in'` for this person, returns sorted list of `YYYY-MM-DD` strings.

Return `{**row, "warnings": warnings}` instead of `row`.

### B-4: New `reports_service` module

File to create: `backend/api/app/services/reports_service.py`

Functions:

**`get_center_settings(sb) -> dict`** — fetches the single `center_settings` row.

**`update_center_settings(sb, patch: dict) -> dict`** — validates and applies partial
update. Validate `open_time` is parseable as `time`, `grace_minutes` >= 0 before
writing. Returns updated row.

**`period_report(month: str, period: str) -> list[dict]`**

1. Parse `month` as `YYYY-MM`; reject (422) if malformed.
2. Compute date window:
   - `h1`: day 1 – day 15 of month.
   - `h2`: day 16 – last day of month (use `calendar.monthrange`).
   - `full`: day 1 – last day of month.
3. Fetch `center_settings` for `open_time`, `grace_minutes`, `tz`.
4. Compute UTC bounds via `manila_day_bounds(start, end)` (import from
   `attendance_service`).
5. Query:
   ```sql
   -- via supabase-py
   attendance
     JOIN people ON people.id = attendance.person_id
   WHERE server_time >= lo AND server_time < hi
     AND people.role = 'teacher'
   ORDER BY person_id, server_time
   ```
6. Group by `person_id`. For each teacher:
   - Group events by Manila-local date.
   - Compute `first_in_local` per day (earliest `in` event).
   - Compute `late_minutes` per day using `open_time` + `grace_minutes`.
   - Detect `missed_checkout` per day: last event of day is `direction = 'in'`.
   - Aggregate `days_present`, `late_days`, `total_late_minutes`, `missed_checkouts`.
7. Return list of `PeriodReportRow`-compatible dicts.

**`period_report_csv(month: str, period: str) -> str`**

Calls `period_report()`, renders to CSV with the column order in Section 1.5, returns
string. Period label mapping: `h1` -> `"H1 {month}"`, `h2` -> `"H2 {month}"`,
`full` -> `"Full {month}"`.

### B-5: New router functions

**File: `backend/api/app/routers/reports.py`** — extend existing router.

Add two endpoints:

```python
@router.get("/period", response_model=list[PeriodReportRow])
def period(month: str, period: str, _: dict = Depends(current_teacher)):
    return reports_service.period_report(month, period)

@router.get("/period.csv", response_class=PlainTextResponse)
def export_period(month: str, period: str, _: dict = Depends(current_teacher)):
    csv_text = reports_service.period_report_csv(month, period)
    safe_period = period.replace("/", "_")
    return PlainTextResponse(
        csv_text,
        headers={
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": f'attachment; filename="period_report_{month}_{safe_period}.csv"',
        },
    )
```

**File: `backend/api/app/routers/admin.py`** — add two endpoints to existing router.

```python
@router.get("/center-settings", response_model=CenterSettingsOut)
def get_center_settings(_: dict = Depends(current_admin)):
    return reports_service.get_center_settings(get_supabase())

@router.patch("/center-settings", response_model=CenterSettingsOut)
def patch_center_settings(body: CenterSettingsPatch, _: dict = Depends(current_admin)):
    return reports_service.update_center_settings(get_supabase(), body.model_dump(exclude_none=True))
```

Import `CenterSettingsOut`, `CenterSettingsPatch` from schemas; import `reports_service`
and `get_supabase` from their respective modules.

---

## Section 3 — Mobile Steps

### C-1: Fix `ApiError` to carry structured 409 body

File: `app/src/services/apiClient.ts`

Currently `ApiError` stores only `status` and `message` (string). The 409 body is now
`{"detail": "...", "code": "..."}` where `detail` is a nested object, not a string
directly. The error parsing block reads `body.detail ?? JSON.stringify(body)`.

Add a `code` field to `ApiError`:

```typescript
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
```

In the error-parsing block, after parsing the JSON body:

```typescript
let detail = res.statusText;
let code: string | undefined;
try {
  const body = await res.json();
  if (typeof body.detail === 'object' && body.detail !== null) {
    // Structured error: {detail: "...", code: "..."}
    detail = body.detail.detail ?? JSON.stringify(body.detail);
    code = body.detail.code;
  } else {
    detail = body.detail ?? JSON.stringify(body);
  }
} catch { /* non-JSON */ }
throw new ApiError(res.status, detail, code);
```

Apply the same parsing change to both `api()` and `apiText()` (both have identical
error-parsing blocks).

### C-2: 409 interception in `CameraScreen` — never enqueue business rejections

File: `app/src/screens/attendance/CameraScreen.tsx`

The current `submit()` function catches `ApiError` and shows an alert for all API
errors, then returns without queuing — this is correct behavior for all 4xx. However,
the alert message is generic. For 409s specifically, use the `detail` string from the
error body (which is already in `e.message` after the C-1 change). No queueing change
needed for the live-submit path; the 409 guard is already working.

Add a specific branch before the generic `ApiError` handler:

```typescript
} catch (e: any) {
  if (e instanceof ApiError && e.status === 409) {
    // Business rejection: already checked in / not checked in.
    // Show the server message immediately. Never queue.
    Alert.alert('Cannot record', e.message);
    setBusy(false);
    return;
  }
  if (e instanceof ApiError) {
    Alert.alert('Failed', e.message ?? 'Could not record attendance');
    setBusy(false);
    return;
  }
  // Network failure: queue.
  ...
}
```

Also update the success path to read `warnings` from the response and trigger the
missed-checkout notice (see C-3 below).

### C-3: Missed-checkout warning display after successful check-in

File: `app/src/screens/attendance/CameraScreen.tsx`

The `logAttendance()` call returns `AttendanceRecord`. Update the `AttendanceRecord`
type (in `app/src/types.ts` or wherever it is defined) to include:

```typescript
warnings?: Array<{ code: 'missed_checkout'; date: string }>;
```

In the success branch of `submit()`, after the `logAttendance` call:

```typescript
const result = await logAttendance({ ... });
await cleanupLocal(photoUri, compressed);

if (result.warnings && result.warnings.length > 0) {
  const missed = result.warnings
    .filter(w => w.code === 'missed_checkout')
    .map(w => w.date)
    .join(', ');
  // Show the missed-checkout notice, then show the success alert on dismiss.
  Alert.alert(
    'Missed checkout detected',
    `${person.full_name} had an open check-in with no checkout on: ${missed}. No changes made to prior records.`,
    [{
      text: 'OK',
      onPress: () =>
        Alert.alert(
          'Recorded',
          `${person.full_name} checked ${direction}.`,
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        ),
    }]
  );
} else {
  Alert.alert(
    'Recorded',
    `${person.full_name} checked ${direction}.`,
    [{ text: 'OK', onPress: () => navigation.goBack() }]
  );
}
```

This is a blocking modal alert chain — the teacher must dismiss the missed-checkout
notice before the success confirmation appears. Keeps it visible; does not auto-dismiss.

### C-4: Sync-queue failed-item visibility

File: `app/src/services/syncQueue.ts`

The current `flush()` function silently drops items with 4xx status. The `dropped`
counter exists in `FlushResult` but is not surfaced in the UI.

Add a separate `failed` table to the SQLite database to persist rejected items instead
of deleting them:

```sql
CREATE TABLE IF NOT EXISTS failed_attendance (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  person_name TEXT NOT NULL,
  direction TEXT NOT NULL,
  device_time TEXT NOT NULL,
  selfie_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  failed_at TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT
);
```

Add exported functions:
- `listFailed(): FailedItem[]` — returns all rows.
- `failedCount(): number` — count of failed rows.
- `dismissFailed(id: string): Promise<void>` — teacher acknowledges; deletes row and
  local selfie file.
- `dismissAllFailed(): Promise<void>` — bulk dismiss.

In `flush()`, replace `await remove(item); dropped++` with:

```typescript
// Move to failed table instead of silent drop.
db.runSync(
  `INSERT OR REPLACE INTO failed_attendance
   (id, person_id, person_name, direction, device_time, selfie_path, created_at, failed_at, error_code, error_message)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [item.id, item.person_id, item.person_name, item.direction,
   item.device_time, item.selfie_path, item.created_at,
   new Date().toISOString(),
   e instanceof ApiError ? String(e.code ?? '') : '',
   e instanceof ApiError ? e.message : String(e)]
);
db.runSync('DELETE FROM pending_attendance WHERE id = ?', [item.id]);
// Do NOT delete the selfie file yet — teacher must acknowledge first.
dropped++;
```

Note: selfie files for failed items are kept until the teacher dismisses them. This
extends device retention beyond the normal immediate-delete path. Add a comment
referencing PROJECT_INSTRUCTIONS §9 and document that `dismissFailed` always deletes
the file.

File: `app/src/screens/attendance/CheckInScreen.tsx`

Import `failedCount` from `syncQueue`. In the `useFocusEffect` load callback, add
`setFailedCount(failedCount())`. Add a state variable `failedCount` and show a
red banner (distinct from the yellow offline/pending banner) when `failedCount > 0`:

```tsx
{failedCount > 0 && (
  <TouchableOpacity style={styles.failedBanner} onPress={() => navigation.navigate('FailedQueue')}>
    <Text style={styles.failedBannerText}>
      {failedCount} item{failedCount !== 1 ? 's' : ''} need attention — tap to review
    </Text>
  </TouchableOpacity>
)}
```

File to create: `app/src/screens/attendance/FailedQueueScreen.tsx`

New screen. Lists `listFailed()` results. Each row shows: person name, direction,
original device_time, error message. Two actions per row: "Dismiss" (calls
`dismissFailed(id)`). A "Dismiss all" button at top. No retry button (the record is
stale; the teacher should check in again manually if the person is present). Refresh
the list on focus.

### C-5: New `PeriodReportScreen`

File to create: `app/src/screens/reports/PeriodReportScreen.tsx`

Controls:
- Month picker: `YYYY-MM` string. Default: current Manila month.
- Period selector: three buttons `H1 (1–15)` / `H2 (16–end)` / `Full month`.
- "Export CSV" button — reuses the existing export path (see C-6).

Data: calls `getPeriodReport(month, period)` from `reportsApi.ts`. Renders a table
with columns: Teacher · Days present · Late days · Total late min · Missed checkouts.
Tapping a row expands inline to show `daily_detail` (date, first-in time, late minutes,
missed-checkout indicator).

File: `app/src/services/reportsApi.ts` — add:

```typescript
export type DailyDetail = {
  date: string;
  first_in: string;
  late_minutes: number;
  missed_checkout: boolean;
};

export type PeriodReportRow = {
  person_id: string;
  full_name: string;
  days_present: number;
  late_days: number;
  total_late_minutes: number;
  missed_checkouts: number;
  daily_detail: DailyDetail[];
};

export const getPeriodReport = (month: string, period: string) =>
  api<PeriodReportRow[]>(`/reports/period?month=${month}&period=${period}`);

export const getPeriodReportCsv = (month: string, period: string) =>
  apiText(`/reports/period.csv?month=${month}&period=${period}`);
```

### C-6: CSV export for period report — reuse existing path

The existing `ExportScreen` is parameterised on `start`/`end` strings and calls
`getHistoryCsv`. Instead of modifying `ExportScreen`, navigate to it with a different
approach: `PeriodReportScreen` has its own inline export button that calls
`getPeriodReportCsv` directly and follows the same `FileSystem.writeAsStringAsync` →
`Sharing.shareAsync` pattern used in `ExportScreen`. Do not add the period export as a
`RootStackParamList` route — keep it self-contained in the screen. This avoids
entangling the two distinct CSV formats behind one screen.

Filename used for sharing: `period_report_<month>_<period>.csv`.

### C-7: Navigation additions

File: `app/src/navigation/RootNavigator.tsx`

Add to `RootStackParamList`:
```typescript
PeriodReport: undefined;
FailedQueue: undefined;
```

Register both screens in the authenticated stack. `PeriodReport` gets a tab entry in
`MainTabs` (or a navigation button from the History tab — product decision, mark as
TBD). `FailedQueue` is a stack screen reachable from the red banner in `CheckInScreen`,
not a tab.

---

## Section 4 — Named Risk: Offline-Queue Interaction with 409

### Current behavior

`flush()` in `syncQueue.ts` catches any `ApiError` where `status >= 400 && status < 500`
and silently drops the item (deletes row + selfie). This includes 409s.

### What breaks with the new 409 codes

When a queued check-in is replayed and the server returns 409 `already_checked_in`, the
current code deletes the item silently. The teacher never knows that the check-in was
accepted by the server on a later manual entry (or that the queue item was a duplicate).
Similarly, `not_checked_in` 409s are silently dropped with no trace.

These are not the same category as "person deactivated" 404s (genuinely unretryable and
uninformative). A 409 from a queue replay is a data discrepancy the teacher should
review.

### Fix required

Section 3 step C-4 above addresses this: move 4xx-rejected items to `failed_attendance`
rather than deleting them. The teacher then sees a red badge, opens `FailedQueueScreen`,
reviews the person/direction/time, and dismisses (acknowledges). This preserves the
audit trail of the attempt without silently losing data.

Critical constraint: the selfie file for a failed item must be retained until the
teacher dismisses. This is an intentional exception to the §9 "no selfies linger"
rule, scoped to the failed-queue path only. The exception must be documented in a
comment in `syncQueue.ts`.

---

## Section 5 — Files to Touch

### New files

- `backend/supabase/migrations/0002_reports.sql` — migration: center_settings table, v_daily_first_in view, v_daily_last_direction view, composite index
- `backend/api/app/services/reports_service.py` — period_report(), period_report_csv(), get_center_settings(), update_center_settings()
- `app/src/screens/reports/PeriodReportScreen.tsx` — new bi-monthly report screen with inline CSV export
- `app/src/screens/attendance/FailedQueueScreen.tsx` — list and dismiss sync-queue failures

### Modified files

- `backend/api/app/models/schemas.py` — add AttendanceWarning, extend AttendanceOut with warnings, add PeriodReportRow, DailyDetail, CenterSettingsOut, CenterSettingsPatch
- `backend/api/app/services/attendance_service.py` — add R1/R2 validation and R3 warning detection in record_attendance(), add _find_missed_checkout_days() helper
- `backend/api/app/routers/reports.py` — add GET /reports/period and GET /reports/period.csv endpoints
- `backend/api/app/routers/admin.py` — add GET /admin/center-settings and PATCH /admin/center-settings endpoints
- `app/src/services/apiClient.ts` — extend ApiError with code field, parse structured 409 body in both api() and apiText()
- `app/src/services/syncQueue.ts` — add failed_attendance table, listFailed(), failedCount(), dismissFailed(), dismissAllFailed(), change flush() to move 4xx rejections to failed table
- `app/src/services/reportsApi.ts` — add getPeriodReport(), getPeriodReportCsv(), PeriodReportRow type, DailyDetail type
- `app/src/screens/attendance/CameraScreen.tsx` — intercept 409 with specific alert, display missed_checkout warnings after successful check-in
- `app/src/screens/attendance/CheckInScreen.tsx` — add failedCount badge and navigation to FailedQueueScreen
- `app/src/navigation/RootNavigator.tsx` — register PeriodReport and FailedQueue screens, add PeriodReport tab or navigation point

---

## Section 6 — Parallelism

After the contracts in Section 1 are agreed and committed to this document, the
following tracks can proceed in parallel:

**Backend track (can start immediately):**
- B-1: Write migration `0002_reports.sql`
- B-2: Add Pydantic schemas
- B-3: Add R1/R2/R3 validation to `attendance_service.py`
- B-4: Write `reports_service.py`
- B-5: Add router endpoints

**Mobile track (can start immediately):**
- C-1: Extend `ApiError` with `code` field
- C-2: 409 interception in `CameraScreen`
- C-3: Missed-checkout warning display (depends on C-2's success path refactor)
- C-4: Sync-queue failed-item visibility (independent of all other mobile work)
- C-5: `PeriodReportScreen` and `reportsApi.ts` additions (can build with mock data)
- C-6: CSV export path in `PeriodReportScreen`

**Dependencies that require backend to be deployed before mobile can test end-to-end:**
- C-3 needs B-3 deployed (R3 warning must be returned by the server).
- C-2 needs B-3 deployed (409 shape must match contract).
- C-5 needs B-4 + B-5 deployed (period endpoint must exist).

Mobile can build and test with mocked API responses before deployment. The contracts in
Section 1 are sufficient to write mocks.

---

## Section 7 — Security Checklist

- `/reports/period` and `/reports/period.csv` use `Depends(current_teacher)`. Any
  authenticated teacher can fetch the period report. This is consistent with the
  Phase 11 spec ("any authenticated teacher can view"). Confirm this is the intended
  access model — if the report should be admin-only, change the dependency.
- `/admin/center-settings` (GET and PATCH) use `Depends(current_admin)`. The
  `current_admin` dependency already exists in `admin.py` and raises 403 for
  non-admin teachers.
- CSV response headers must include `Content-Disposition: attachment` (not inline) to
  prevent browsers from rendering the file directly. Confirm both `/reports/history.csv`
  (existing) and `/reports/period.csv` (new) set this header. The existing
  `export_history` endpoint in `reports.py` already sets it correctly.
- Cross-center data isolation: the `attendance` table does not have a `center_id`
  column in `0001_init.sql`. All attendance rows in a single Supabase project belong
  to one center (single-tenant deployment per center). The period report query filters
  by `role = 'teacher'` but not by center. If multi-tenant is ever required, this is
  a significant migration — flag it as a deferred risk. For now, single-tenant is
  assumed; document the assumption in `reports_service.py`.
- The `center_settings` table has one row enforced by the `check (id = 1)` constraint.
  The PATCH endpoint must use `UPDATE ... WHERE id = 1` — not INSERT — to preserve
  the singleton invariant.
- `tz` field on `CenterSettingsOut` is returned to the client but must not be
  user-controlled in a way that allows reading data from other timezones to infer
  cross-center information. Since the period report computation runs server-side, the
  `tz` field only affects display formatting; restrict valid values to a known-safe
  list (e.g. validate against `zoneinfo.available_timezones()`) if PATCH allows writing
  it.

---

## Section 8 — Migration Checklist

- [ ] `0002_reports.sql` contains no `DROP TABLE`, `DROP COLUMN`, `DELETE`, `TRUNCATE`,
      `ALTER TABLE ... DROP COLUMN`, or `ALTER TABLE ... RENAME COLUMN`.
- [ ] The migration is idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
      `INSERT ... ON CONFLICT DO NOTHING`, `CREATE OR REPLACE VIEW`.
- [ ] The migration has been reviewed against `0001_init.sql` to confirm no column or
      table name collision.
- [ ] Rollback steps are documented in a comment block at the bottom of the migration file.
- [ ] The migration has been tested on a branch Supabase project before applying to
      production.
- [ ] RLS policies on `center_settings` have been verified: teachers can SELECT, admins
      can UPDATE, no INSERT or DELETE policies (the singleton row is seeded by the
      migration and must not be replaced).
- [ ] The composite index `idx_attendance_person_time (person_id, server_time)` does not
      conflict with the existing `idx_attendance_person (person_id)` in `0001_init.sql`.
      The new index is a superset and will be used for the R1/R2 validation query
      (`WHERE person_id = ? AND server_time >= ? AND server_time < ?`).

---

## Test Checklist (for cam-qa)

### Validation rules

- [ ] POST /attendance with direction=in when the person is already checked in today returns
      HTTP 409, body contains `code: "already_checked_in"` and `detail: "Already checked in"`.
- [ ] POST /attendance with direction=out when the person has no open check-in today returns
      HTTP 409, body contains `code: "not_checked_in"` and `detail: "Not checked in"`.
- [ ] POST /attendance with direction=out when the person has an open check-in today succeeds
      (HTTP 201), `warnings` is an empty array.
- [ ] POST /attendance with direction=in when the person's last event on a prior Manila day
      was check-in with no checkout returns HTTP 201 and `warnings` contains one element
      with `code: "missed_checkout"` and the correct prior date.
- [ ] POST /attendance with direction=in when the person had missed checkouts on two prior
      days returns HTTP 201 and `warnings` contains two elements ordered oldest-date-first.
- [ ] POST /attendance with direction=in when the person has no prior events returns HTTP 201
      and `warnings` is an empty array.
- [ ] POST /attendance without a selfie still returns HTTP 400 (existing behaviour unchanged).

### Period report

- [ ] GET /reports/period?month=2026-07&period=h1 returns HTTP 200 with an array of
      PeriodReportRow objects.
- [ ] GET /reports/period?month=2026-07&period=h2 covers only days 16–31 (or 16–30 for
      months with 30 days).
- [ ] GET /reports/period?month=2026-07&period=full covers all days of the month.
- [ ] `missed_checkouts` count in the response matches the number of days in the period
      where the teacher's last event was direction=in.
- [ ] `late_days` and `total_late_minutes` match the lateness model in Phase 11 spec A.2.
- [ ] Report includes only people with role=teacher (students must not appear).
- [ ] GET /reports/period without auth returns 401.
- [ ] GET /reports/period.csv returns Content-Type text/csv and Content-Disposition attachment.
- [ ] CSV column order matches: teacher_name, period, days_present, late_days,
      total_late_minutes, missed_checkouts.
- [ ] GET /reports/period?month=bad&period=h1 returns 422.
- [ ] GET /reports/period?month=2026-07&period=invalid returns 422.

### Center settings

- [ ] GET /admin/center-settings returns HTTP 200 with open_time, grace_minutes, tz.
- [ ] GET /admin/center-settings by a non-admin teacher returns HTTP 403.
- [ ] PATCH /admin/center-settings with `{"grace_minutes": 15}` returns updated settings
      and GET confirms the change persisted.
- [ ] PATCH /admin/center-settings with an invalid value (e.g. `{"grace_minutes": -1}`)
      returns 422.
- [ ] PATCH /admin/center-settings by a non-admin teacher returns 403.

### Mobile — 409 interception

- [ ] Tapping "Confirm check in" for a person already checked in (live network): shows
      alert with the server's detail message; does not navigate away; does not add to
      the sync queue.
- [ ] Tapping "Confirm check out" for a person not checked in: same behaviour.
- [ ] In offline mode: check-in is queued. On flush, if the server returns 409, the item
      appears in FailedQueueScreen with the error message; it does not disappear silently.

### Mobile — missed-checkout warning

- [ ] Checking in a person who missed a checkout yesterday: after the 201 response, an
      alert appears naming the missed date before the success confirmation.
- [ ] The missed-checkout alert is dismissible; after dismissal the success alert appears.
- [ ] Checking in a person with no prior missed checkouts: no missed-checkout alert,
      only the success alert.

### Mobile — failed queue visibility

- [ ] After a queued item is rejected 4xx on flush, a red banner appears on CheckInScreen.
- [ ] Tapping the banner opens FailedQueueScreen showing the rejected item's person, direction,
      and error message.
- [ ] "Dismiss" on a failed item removes it from the list and the red banner count decrements.
- [ ] "Dismiss all" clears all failed items and the banner disappears.
- [ ] Selfie files for failed items are deleted when the item is dismissed (verify via
      FileSystem.getInfoAsync on the stored path after dismiss).

### Mobile — PeriodReportScreen

- [ ] PeriodReportScreen loads and displays rows after selecting month and period.
- [ ] Tapping a row expands per-day detail showing date, first_in, late_minutes,
      missed_checkout indicator.
- [ ] "Export CSV" button produces a downloadable file with the correct column order.
- [ ] The period selector correctly maps H1/H2/Full to the query parameter values h1/h2/full.
