# Plan: Selfie Review

**Feature:** A teacher taps an attendance row in the History screen or Today screen to view
the selfie captured at that check-in or check-out, to visually verify the log is valid.

**Branch:** `feat/selfie-review`  
**Date drafted:** 2026-07-08

---

## Goal

Expose a short-lived signed URL for a single attendance record's selfie image through a
new protected API endpoint. The mobile client fetches the URL on demand when a row is
tapped, displays the image in an in-memory modal, and discards the URL on dismiss.
No image data is ever written to device disk, AsyncStorage, or the photo library.

---

## API Contract

> This section is the single source of truth. Both the backend and mobile teams build
> to this contract. It must not change mid-build. Any amendment goes through the planner
> first, then both dev agents resume from the updated file.

### Endpoint

```
GET /attendance/{attendance_id}/selfie
```

**Auth:** `Authorization: Bearer <Supabase JWT>` — same `current_teacher` dependency
used by all other protected routes.

**Path parameter**

| Parameter | Type | Description |
|---|---|---|
| `attendance_id` | UUID string | The `id` column from the `attendance` table. |

**Query parameters:** none.

**Signed-URL TTL — hard constraint**

The signed URL TTL is exactly **60 seconds**. This value is not configurable per-request
and cannot be overridden by the caller. It is enforced by the `SELFIE_URL_TTL = 60`
constant in `storage_service.py` and is always reflected in the `expires_in` response
field. Any proposed change to this value must go through the planner and the security
checklist must be re-evaluated.

**Success response — HTTP 200**

```json
{
  "url": "https://<supabase-project>.supabase.co/storage/v1/object/sign/selfies/...?token=...",
  "expires_in": 60
}
```

| Field | JSON type | Constraints | Nullable | Required |
|---|---|---|---|---|
| `url` | string | HTTPS URL; non-empty; Supabase Storage signed URL | no | yes |
| `expires_in` | integer | Always exactly `60`; never any other value | no | yes |

**Error responses**

All error bodies follow FastAPI's standard `HTTPException` envelope:
`{"detail": "<human-readable message string>"}`. There is no additional wrapping or
extra fields. The `detail` string values below are normative — tests should match them
exactly.

| HTTP status | Condition | Response body |
|---|---|---|
| 401 Unauthorized | `Authorization` header absent, does not start with `Bearer `, or the JWT is invalid/expired. | `{"detail": "Missing bearer token"}` or `{"detail": "Invalid token"}` |
| 403 Forbidden | Valid JWT but the `auth_user_id` claim has no matching row in `teacher_accounts`. | `{"detail": "Not a teacher account"}` |
| 404 Not Found | `attendance_id` does not exist in the `attendance` table. | `{"detail": "Selfie not found"}` (exact string chosen by backend implementer; tests must match what is coded) |
| 409 Conflict | The `attendance` row exists but `selfie_url` is `""` or `None` — selfie was purged by the retention job or was never uploaded. | `{"detail": "Selfie for this record has been purged"}` |
| 502 Bad Gateway | Supabase Storage `create_signed_url()` call failed or returned an empty string. | `{"detail": "Could not generate signed URL"}` (exact string chosen by backend implementer; tests must match what is coded) |

All error responses use `Content-Type: application/json`. There are no empty-body error
responses from this endpoint.

**No pagination, no body on requests, no multipart.**

---

## Files to Touch

### Backend (new or modified)

| Path | Change |
|---|---|
| `backend/api/app/routers/attendance.py` | Add `GET /{attendance_id}/selfie` route using `current_teacher` dependency; call new service function. |
| `backend/api/app/services/storage_service.py` | Reduce default `expires_in` on `signed_url()` from `3600` to `60`; add a named constant `SELFIE_URL_TTL = 60`. |
| `backend/api/app/services/attendance_service.py` | Add `get_selfie_url(attendance_id: str) -> dict` — fetch the row, validate `selfie_url` non-empty, delegate to `storage_service.signed_url()`. |
| `backend/api/app/models/schemas.py` | Add `SelfieUrlOut` Pydantic schema: `url: str`, `expires_in: int`. |

### Mobile (new or modified)

| Path | Change |
|---|---|
| `app/src/services/attendanceApi.ts` | Add `getSelfieUrl(attendanceId: string): Promise<SelfieUrlResponse>` calling `GET /attendance/{id}/selfie`. |
| `app/src/types/index.ts` | Add `SelfieUrlResponse` interface (`url: string; expires_in: number`) and add `last_attendance_id` field to `TodayRow`. |
| `app/src/components/SelfieModal.tsx` | **New file.** Reusable modal that receives an `attendanceId`, fetches the signed URL on open, renders the image in-memory, and exposes no disk-write path. Clears the URL on dismiss. |
| `app/src/screens/reports/HistoryScreen.tsx` | Wrap attendance rows in `TouchableOpacity`; maintain `selectedId` state; render `<SelfieModal>`. |
| `app/src/screens/attendance/TodayScreen.tsx` | Same tap pattern as HistoryScreen. Requires `last_attendance_id` to be present on each `TodayRow`. |

### Backend — schema/data gap fix

`TodayRow` in both backend and client currently omits the `attendance` row `id`.
The Today board groups by person and only exposes `person_id`, which is not the
attendance record identifier. The signed-URL endpoint needs the attendance `id`,
not the person `id`.

| Path | Change |
|---|---|
| `backend/api/app/models/schemas.py` | Add `last_attendance_id: str` to `TodayRow`. |
| `backend/api/app/services/attendance_service.py` | Expose `id` from the winning attendance row in `today_board()`. |
| `app/src/types/index.ts` | Add `last_attendance_id: string` to `TodayRow` (already listed above). |

---

## Steps (Ordered)

### Step 0 — Agree on contract (blocking, before any dev work)

0.1. Both backend and mobile teams read this file and confirm the API contract section is
     sufficient before writing any code. Raise amendments through the planner, not in code.

### Step 1 — Backend (can proceed after Step 0)

1.1. In `storage_service.py`, add `SELFIE_URL_TTL = 60` constant. Change `signed_url()`
     default from `expires_in=3600` to `expires_in=SELFIE_URL_TTL`. Existing callers pass
     no argument so they pick up the new default automatically — verify no other caller
     passes an explicit value that would break.

1.2. In `schemas.py`, add:
     ```python
     class SelfieUrlOut(BaseModel):
         url: str
         expires_in: int
     ```
     Also add `last_attendance_id: str` to `TodayRow`.

1.3. In `attendance_service.py`, add `get_selfie_url(attendance_id: str) -> dict`:
     - Query `attendance` table for the row by `id`.
     - If not found, raise `HTTP 404`.
     - If `selfie_url` is empty string or None, raise `HTTP 409` with detail
       `"Selfie for this record has been purged"`.
     - Call `storage_service.signed_url(row["selfie_url"], SELFIE_URL_TTL)`.
     - If the result is an empty string (Storage error), raise `HTTP 502`.
     - Return `{"url": signed_url, "expires_in": SELFIE_URL_TTL}`.
     Also update `today_board()` to include `id` as `last_attendance_id` in the returned
     dict for each seen person (the first/winning row's `id`).

1.4. In `attendance.py` router, add:
     ```python
     @router.get("/{attendance_id}/selfie", response_model=SelfieUrlOut)
     def get_selfie(attendance_id: str, _: dict = Depends(current_teacher)):
         return attendance_service.get_selfie_url(attendance_id)
     ```
     Import `SelfieUrlOut` from schemas. This must be declared after the existing
     `/today` route to avoid FastAPI treating `today` as a path parameter value.

### Step 2 — Mobile (can proceed after Step 0, in parallel with Step 1)

2.1. In `types/index.ts`, add `SelfieUrlResponse` and add `last_attendance_id: string`
     to `TodayRow`.

2.2. In `services/attendanceApi.ts`, add:
     ```ts
     export interface SelfieUrlResponse { url: string; expires_in: number; }

     export const getSelfieUrl = (attendanceId: string) =>
       api<SelfieUrlResponse>(`/attendance/${attendanceId}/selfie`);
     ```

2.3. Create `app/src/components/SelfieModal.tsx`:
     - Props: `attendanceId: string | null`, `visible: boolean`, `onClose: () => void`,
       plus display metadata (`personName: string`, `direction: Direction`,
       `serverTime: string`).
     - On `visible` becoming `true` (and `attendanceId` non-null): call `getSelfieUrl`,
       store the URL in local component state (a `useState<string | null>`). This is
       in-memory React state only — no `AsyncStorage`, no `expo-file-system`, no
       `expo-media-library`.
     - Render a React Native `Modal` (or a bottom sheet with `Modal` as the container).
       Display name, direction badge, time, and the image via `<Image source={{ uri: url }} />`.
     - Show a loading spinner while the URL is being fetched.
     - Show a non-blocking error message (e.g. "Could not load selfie") if the API returns
       404 or 409; do not crash the modal.
     - On close (`onClose` callback or backdrop tap): call `onClose()` and clear the URL
       from state (`setUrl(null)`) so nothing lingers in memory.
     - On re-open: always re-fetch (do not reuse a previously fetched URL — it may have
       expired).

2.4. In `HistoryScreen.tsx`:
     - Add state: `const [selectedId, setSelectedId] = useState<string | null>(null)`.
     - Add state for display metadata (name, direction, server_time) to pass to the modal.
     - Wrap the row `<View>` in `<TouchableOpacity onPress={() => { setSelectedId(row.id); ... }}`.
     - Render `<SelfieModal attendanceId={selectedId} visible={selectedId !== null} onClose={() => setSelectedId(null)} ... />` outside the `FlatList`.

2.5. In `TodayScreen.tsx`:
     - Same pattern. The `TodayRow` now carries `last_attendance_id`; use that as the
       `attendanceId` prop.
     - Wrap `renderItem` row in `<TouchableOpacity>`.
     - Render `<SelfieModal>` outside the `SectionList`.

### Step 3 — Integration check

3.1. Confirm the router ordering in `attendance.py`: `GET /today` must be declared before
     `GET /{attendance_id}/selfie` to prevent FastAPI from capturing the literal string
     `"today"` as a UUID path parameter. The existing `@router.get("/today", ...)` is
     already first; the new route appended at the bottom is correct.

3.2. Confirm `HistoryRow` already exposes `id` — **confirmed, no change needed**.

     Backend (`backend/api/app/models/schemas.py`, line 61): `HistoryRow` has `id: str`
     as its first field.

     Mobile (`app/src/types/index.ts`, line 38): `HistoryRow` has `id: string` as its
     first field.

     The field name is `id` on both sides, not `attendance_id`. The `HistoryScreen`
     implementation in Step 2.4 must use `row.id`, not `row.attendance_id`. No schema
     changes are needed for the History screen to obtain the attendance ID.

3.3. Confirm `TodayRow` changes are consistent: backend schema, backend service, and
     client type all add `last_attendance_id` together.

---

## Parallelism Note

After Step 0 (API contract agreed), the following can proceed in parallel with no blocking
dependency between tiers:

- **Backend team** executes Steps 1.1 through 1.4 independently.
- **Mobile team** executes Steps 2.1 through 2.5 independently.

The mobile `getSelfieUrl()` call will fail at runtime until the backend is deployed, but
TypeScript compilation and component wiring can be fully completed and verified with
`tsc --noEmit` before the backend is up. Integration testing requires both tiers.

---

## Security Checklist

| Item | Requirement | Implementation |
|---|---|---|
| Signed URL TTL | Maximum 60 seconds | `SELFIE_URL_TTL = 60` constant in `storage_service.py`; returned as `expires_in` in response so the client knows the window. |
| Bucket stays private | No public URLs ever | `storage_service.signed_url()` uses `create_signed_url()`, not `get_public_url()`. The bucket is configured private in Supabase. No change to that configuration. |
| Auth guard | Every call authenticated | `Depends(current_teacher)` on the new route, same as all other protected routes. |
| No cross-user path leakage | Response carries only one record's URL | `get_selfie_url()` looks up by `attendance_id` primary key only; it does not expose `selfie_url` storage path directly in the response — only the signed URL. |
| No persistent client cache | RA 10173, §9 | URL stored only in React component `useState`. Not written to `AsyncStorage`, `expo-file-system`, `expo-media-library`, or the `syncQueue` SQLite store. Cleared on modal close. |
| Re-fetch on re-open | Signed URLs expire | Modal clears URL on close and fetches fresh on each open. No URL reuse across sessions. |
| Audit consideration | Optional, low-priority | The existing `attendance` row already records `logged_by` and `server_time`. A separate access log for selfie views is out of scope for v1 but should be noted as a v2 hardening item if audit requirements are raised. |
| HTTPS in transit | Mandatory | Supabase Storage signed URLs are HTTPS only. FastAPI is deployed behind TLS (Render/Fly). No change needed. |

---

## Risks / Trade-offs

**R1 — 60-second TTL is tight on slow connections.**
If the device fetches the URL and then the user is on a slow network, the image request
may arrive after the URL expires (Supabase returns 400). The modal should handle this
gracefully by showing an error state with a "Retry" button that re-calls `getSelfieUrl`.
A 60-second TTL is the maximum acceptable under the privacy constraint; do not raise it.

**R2 — `TodayRow` schema change is a breaking change for existing callers.**
Adding `last_attendance_id` to `TodayRow` is additive and non-breaking for clients that
ignore unknown fields (React Native JSON parsing does). No migration is needed. However,
the backend service change (`today_board()` returning `last_attendance_id`) must ship at
the same time as the schema change, or the existing endpoint returns rows missing the
field and the Today screen tap will pass `undefined` as `attendanceId`.

**R3 — Router path ambiguity.**
FastAPI evaluates routes in declaration order. The literal route `/today` must remain
declared before `/{attendance_id}/selfie`. If a future developer inserts a route between
them carelessly, FastAPI could capture `today` as a path parameter. Mitigate: add a
comment in `attendance.py` above the new route warning about ordering.

**R4 — Selfie purge race condition.**
The retention job (run via `POST /admin/purge-selfies`) clears `selfie_url` to `""` after
90 days. If a teacher taps a row for a purged record, the API returns HTTP 409. The modal
must handle this gracefully with a user-readable message such as "Selfie has been deleted
per retention policy" rather than a generic error.

**R5 — `storage_service.signed_url()` default TTL change affects existing callers.**
Currently `signed_url()` defaults to `expires_in=3600`. Search the entire backend for
any call that relies on the old default. Current callers: none (the function exists but
is not called at request time anywhere in the existing codebase — `upload_selfie` returns
a path, and signed URLs are not generated during `record_attendance`). Confirm with a
grep before shipping.

---

## Test Checklist (for cam-qa)

### Backend (pytest)

- `test_get_selfie_url_returns_200_with_url`: mock the Supabase client; given a valid
  `attendance_id` with a non-empty `selfie_url`, assert response is HTTP 200 with `url`
  and `expires_in == 60`.
- `test_get_selfie_url_404_unknown_id`: attendance_id that does not exist returns 404.
- `test_get_selfie_url_409_purged_selfie`: row exists but `selfie_url` is `""`, returns
  409 with detail `"Selfie for this record has been purged"`.
- `test_get_selfie_url_401_no_token`: no Authorization header returns 401.
- `test_get_selfie_url_403_non_teacher`: valid JWT but no `teacher_accounts` row returns
  403.
- `test_today_board_includes_last_attendance_id`: `today_board()` result dicts include
  `last_attendance_id` as a non-empty string.
- `test_signed_url_ttl_is_60`: `storage_service.SELFIE_URL_TTL == 60`.

### Mobile (TypeScript compiler)

- `npx tsc --noEmit` from `app/` must exit 0 with no errors after all mobile changes.
- Verify `SelfieModal` props match the interface defined in the plan (no implicit `any`).
- Verify `getSelfieUrl` return type is `Promise<SelfieUrlResponse>`.

### Secret scan

- `gitleaks detect --no-git -s .` at repo root: no findings. The signed URL itself must
  never appear in any committed file (it is runtime-only, in component state).

### Integration (manual smoke test — cam-qa cannot automate this)

- Log in; open History; tap a recent row; confirm modal opens and selfie image renders.
- Confirm modal closes cleanly; confirm re-tapping the same row re-fetches the URL.
- Confirm tapping a row whose selfie was purged shows a graceful error message (409 path).
- Open Today tab; confirm rows are tappable and the modal works with `last_attendance_id`.
- On a slow-network simulation: confirm the loading spinner appears and an expired-URL
  retry is possible.
