# CAM — Step-by-Step Build Guide (beginner / macOS)

The single canonical build guide for **CAM (Center Attendance Monitoring)**.

**Stack (locked):** Expo / React Native (TypeScript) · FastAPI (Python) · Supabase (Postgres + Auth + Storage). All free tiers.
**Audience:** experienced engineer, new to the mobile/JS/Python ecosystem, building on a MacBook.
**Method:** follow phases in order. Each ends with a **✅ Checkpoint** — don't move on until it passes. Phases map to the spec's milestones (M1–M6 in `docs/PROJECT_INSTRUCTIONS.md`).

> The older `eyelevel-build-guide.md` / `V1__init.sql` (Spring Boot + React PWA) describe an **alternate stack** for the *same product idea*. They are **superseded** by this guide and kept only as the Phase 11 "grow into a Dashboard" reference. Build from *this* file.

---

## How the repo is laid out (already scaffolded for you)

```
CAM-Center Attendance Monitoring/
├── app/         # TIER 1 — Expo React Native client (src/ written, needs Expo init)
├── backend/
│   ├── api/     # TIER 2 — FastAPI backend (code written, needs venv + .env)
│   └── supabase/migrations/0001_init.sql   # TIER 3 — schema + RLS
└── docs/        # spec, data model, decisions
```

The three tiers and the rule "**the client never touches the DB directly — it only calls FastAPI**" are explained in `docs/PROJECT_INSTRUCTIONS.md §7`. Keep that rule in your head; it's the whole point of the architecture.

---

## Phase 0 — Set up your Mac (one-time toolchain)

You do this once. Everything is free.

### 0.1 Install the base tools

```bash
# 1. Xcode Command Line Tools — gives you git, make, compilers
xcode-select --install

# 2. Homebrew — the macOS package manager (paste the line from https://brew.sh)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 3. Node via nvm (lets you switch Node versions cleanly — better than brew for this)
brew install nvm
mkdir ~/.nvm
# add nvm to your shell, then restart the terminal:
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "$(brew --prefix nvm)/nvm.sh" ] && . "$(brew --prefix nvm)/nvm.sh"' >> ~/.zshrc
# (open a new terminal tab, then:)
nvm install --lts          # Node 20+
nvm alias default lts/*

# 4. Watchman — makes Expo/React Native file-watching fast and reliable
brew install watchman

# 5. Python 3.12 for the backend
brew install python@3.12

# 6. Editor
brew install --cask visual-studio-code
```

### 0.2 Install the Expo Go app on your phone

On your iPhone (App Store) or Android (Play Store), install **Expo Go**. This is how you'll run the app on a real device with **no Xcode or Android Studio needed**. You only need those later (Phase 9) if you want to ship a standalone build or use an on-screen simulator.

### 0.3 Create free accounts

| Service | Used for | URL |
|---|---|---|
| GitHub | version control | github.com |
| Supabase | database + auth + selfie storage | supabase.com |
| Expo (EAS) | mobile builds later | expo.dev |
| Render | host the FastAPI backend (Phase 9) | render.com |

### ✅ Checkpoint 0
All of these print a version, no errors:
```bash
git --version
node -v        # v20.x or higher
npm -v
watchman --version
python3.12 --version
```
And **Expo Go** is installed on your phone, with the phone on the **same Wi-Fi** as your Mac.

---

## Phase 1 — Git & GitHub (M1)

You're already inside the project folder. Put it under version control and push it.

```bash
cd "/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring"

# safety: make sure secrets never get committed
cat > .gitignore <<'EOF'
# python
backend/api/.venv/
__pycache__/
*.pyc
# node / expo
app/node_modules/
app/.expo/
# secrets
.env
*.env
!*.env.example
# macOS
.DS_Store
EOF

git init
git add .
git commit -m "chore: CAM skeleton"
```

Create an empty repo on GitHub named `cam-attendance` (no README), then:
```bash
git remote add origin https://github.com/<your-username>/cam-attendance.git
git branch -M main
git push -u origin main
```

### ✅ Checkpoint 1
Repo visible on GitHub. `git status` shows a clean tree. No `.env` file is tracked (`git ls-files | grep .env` shows only `*.env.example`).

---

## Phase 2 — Supabase: database, auth, storage (M1, data tier)

This is the tier you already started. Full sequence:

1. **Create the project.** Supabase dashboard → New project. Region: **Singapore** (closest to PH). Save the database password somewhere safe.
2. **Run the schema.** SQL Editor → paste the contents of `backend/supabase/migrations/0001_init.sql` → **Run**. Confirm `people`, `teacher_accounts`, `attendance` appear under Table Editor.
3. **Create the storage bucket.** Storage → New bucket → name `selfies` → **Private** (toggle OFF "Public bucket"). Selfies are minors' data; access is via signed URLs through the API only.
4. **Add a storage policy** so the backend (service role) can write/read. SQL Editor:
   ```sql
   -- allow the service role full access to the selfies bucket
   create policy "service role manages selfies"
   on storage.objects for all
   to service_role
   using (bucket_id = 'selfies')
   with check (bucket_id = 'selfies');
   ```
   (The backend uses the service-role key, which already bypasses RLS, but this keeps the bucket explicit and locked to that role.)
5. **Bootstrap your first teacher/admin.** RLS locks everyone out until a `teacher_accounts` row exists — and the app can't create the first one (chicken-and-egg). So:
   - Authentication → **Users** → Add user → your email + a password. Copy the user's **UUID**.
   - SQL Editor (runs as `postgres`, bypasses RLS):
     ```sql
     insert into people (full_name, role) values ('Teng De Leon', 'teacher')
       returning id;
     insert into teacher_accounts (person_id, auth_user_id, is_admin)
     select id, '<PASTE-AUTH-USER-UUID>'::uuid, true
     from people where full_name = 'Teng De Leon';
     ```
6. **Collect your keys** (Settings → API, and Settings → API → JWT Settings):
   - `Project URL` → `https://xxxx.supabase.co`
   - `anon` public key → goes in the **app** (client)
   - `service_role` key → goes in the **backend only**, never the app
   - `JWT Secret` → backend uses it to verify tokens

### ✅ Checkpoint 2
`select * from teacher_accounts;` in the SQL editor returns your row with `is_admin = true`. You have the four secrets saved.

> ⚠️ Free-tier note: a Supabase free project **pauses after ~7 days of no activity**. Daily center use keeps it awake; if you leave it idle during development, the first request after a pause is slow or errors until it resumes. Normal — not a bug.

---

## Phase 3 — Backend: run FastAPI locally (M1, server tier)

```bash
cd "/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring/backend/api"

# create an isolated Python environment (so deps don't pollute your Mac)
python3.12 -m venv .venv
source .venv/bin/activate          # you'll run this every time you open a new terminal here
pip install -r requirements.txt

# create your real secrets file from the template
cp .env.example .env
```

Edit `backend/api/.env` and fill in the real values from Phase 2:
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role key>
SUPABASE_JWT_SECRET=<JWT secret>
SELFIE_BUCKET=selfies
RETENTION_DAYS=90
ALLOWED_ORIGINS=http://localhost:8081,exp://127.0.0.1:19000
```

Run it — note `--host 0.0.0.0` so your **phone can reach it later**, not just your Mac:
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000/docs** in your browser. FastAPI auto-generates an interactive API page — this is your best friend for testing the backend without the app. Hit `GET /health`; it should return `{"status":"ok"}`.

### ✅ Checkpoint 3
`http://localhost:8000/docs` loads and `GET /health` returns `200 {"status":"ok"}`. `pytest` passes (`cd backend/api && pytest`).

---

## Phase 4 — App: run on your phone & log in (M1, client tier)

The `app/src/` code exists, but `app/` isn't a real Expo project yet (the `package.json` is a placeholder). You'll initialize Expo, then keep the existing `src/`.

### 4.1 Initialize the Expo project (preserving src/)

```bash
cd "/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring"

# scaffold a fresh Expo app in a temp folder
npx create-expo-app@latest app-tmp --template blank-typescript

# bring your existing source + config into it
cp -R app/src app-tmp/src
cp app/.env.example app-tmp/.env.example
cp -R app/assets app-tmp/assets 2>/dev/null

# swap it in
rm -rf app-skeleton && mv app app-skeleton   # keep the old skeleton as backup
mv app-tmp app
cd app
```

### 4.2 Install the libraries the app needs

Use **`npx expo install`** (not plain `npm install`) for anything with native code — it picks versions matching your Expo SDK. Pure-JS libs can use either.

```bash
# native modules — MUST use expo install for compatible versions
npx expo install expo-camera expo-sqlite expo-image-manipulator expo-file-system \
  @react-native-async-storage/async-storage react-native-screens react-native-safe-area-context

# pure JS — npm is fine
npm install @supabase/supabase-js react-native-url-polyfill \
  @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs
```

### 4.3 Point the app at your backend — the #1 beginner gotcha

Your phone running Expo Go is a **separate device**. `http://localhost:8000` on the phone means *the phone itself*, not your Mac. You must use your Mac's **LAN IP**.

```bash
# find your Mac's IP on the Wi-Fi network
ipconfig getifaddr en0     # e.g. 192.168.1.5  (try en1 if en0 is blank)
```

Create `app/.env`:
```
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.5:8000      # ← your Mac's LAN IP, NOT localhost
```

Then add that IP to the backend's `ALLOWED_ORIGINS` (and to be safe during dev you can append `http://192.168.1.5:8081`), and restart uvicorn. When you first run, macOS may pop a firewall prompt for Python — click **Allow**.

### 4.4 Wire up Supabase auth (client = auth only)

Supabase's JS client needs a storage adapter and a URL polyfill on React Native, or sessions won't persist. Your `src/services/supabaseClient.ts` should look like:
```ts
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,   // required on React Native
    },
  }
);
```
And your `apiClient.ts` attaches the token to every backend call:
```ts
const { data } = await supabase.auth.getSession();
const token = data.session?.access_token;
fetch(`${process.env.EXPO_PUBLIC_API_BASE_URL}/people`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

### 4.5 Run it

```bash
npx expo start
```
A QR code appears. **iPhone:** open Camera, point at the QR, tap the banner. **Android:** open Expo Go → Scan QR. The app loads on your phone over Wi-Fi. Edit a file, save, and it hot-reloads instantly.

### ✅ Checkpoint 4
The app opens in Expo Go on your phone. You log in with the email/password from Phase 2, and the app receives a token (a roster or "today" screen loads from the backend instead of an auth error).

---

## Phase 5 — Roster screens (M2)

Goal: list, search, and (admin) add/edit people.

- Backend endpoints already defined: `GET /people` (any teacher), `POST /people` / `PATCH /people/{id}` / `DELETE /people/{id}` (admin only). Test each in `/docs` first.
- App: `screens/roster/RosterListScreen` calls `GET /people`, renders a searchable list with a teacher/student filter. `PersonFormScreen` (admin) posts new people.
- Confirm the admin gate: log in as a non-admin teacher → add-person should 403.

### ✅ Checkpoint 5
You can see the roster in the app, search it, and (as admin) add a student that then appears in the list and in the Supabase `people` table.

---

## Phase 6 — Selfie capture & check-in/out (M3, the core)

This is the heart of the app — the flow in `PROJECT_INSTRUCTIONS.md §4`.

1. **Camera permission + capture** with `expo-camera` (front camera):
   ```ts
   const [permission, requestPermission] = useCameraPermissions();
   // ...render <CameraView facing="front" ref={camRef} />
   const photo = await camRef.current.takePictureAsync({ quality: 0.6 });
   ```
2. **Compress before upload** to protect the 1 GB free storage cap (~50–80 KB target):
   ```ts
   import * as ImageManipulator from 'expo-image-manipulator';
   const small = await ImageManipulator.manipulateAsync(
     photo.uri,
     [{ resize: { width: 720 } }],
     { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
   );
   ```
3. **Send multipart** `POST /attendance` with: `person_id`, `direction` (in/out), `device_time` (the phone's clock), and the image file. The Bearer token goes in the header.
4. **Backend** validates the person, uploads the selfie to `selfies/{yyyy}/{mm}/{dd}/{attendance_id}.jpg`, sets `server_time = now()` (the source of truth), and inserts the `attendance` row.

Rules to honor: **no selfie → no record**; the **server** sets the authoritative timestamp; direction defaults from last known state but the teacher can override.

### ✅ Checkpoint 6
From the app: pick a person → Check In → capture selfie → submit. A new row appears in the `attendance` table, and the image appears in the `selfies` bucket under today's date.

---

## Phase 7 — Today board & History (M4)

- **Today** (`GET /attendance/today`): latest event per person for the current date → show who's *in* vs *out*. Render as a live list.
- **History** (`screens/reports/HistoryScreen`): date-range filter, joined to person names. Backend filters `attendance` by `server_time::date`.

Remember: store times as UTC, **display in Asia/Manila** (use your `utils/date` helper).

### ✅ Checkpoint 7
The Today screen correctly shows a person as "in" after check-in and flips to "out" after check-out. History filtered to today lists the events you created.

---

## Phase 8 — Offline queue & CSV export (M5)

**Offline queue** (`services/syncQueue` + `expo-sqlite`): when a check-in fails because there's no network, save the request **and the image** to a local SQLite table marked `pending`. A background task (triggered by `useNetwork` detecting connectivity) replays each pending item against `POST /attendance`, then clears it. Test by enabling Airplane Mode, doing a check-in, re-enabling Wi-Fi, and watching it sync.

**CSV export** (`GET /reports/history.csv`): backend streams person name, role, direction, server_time (Manila), and the logging teacher's name for a date range. The app saves it with `expo-file-system` and opens the share sheet.

### ✅ Checkpoint 8
A check-in made in Airplane Mode shows as `pending`, then syncs automatically when the network returns (row appears server-side, local `pending` clears). You can export a date range to CSV and share it off the phone.

---

## Phase 9 — Deploy (backend on Render, app via Expo)

### 9.1 Backend → Render (free web service)
1. Add `backend/api/Dockerfile` (or use Render's native Python build). Minimal Dockerfile:
   ```dockerfile
   FROM python:3.12-slim
   WORKDIR /app
   COPY requirements.txt .
   RUN pip install --no-cache-dir -r requirements.txt
   COPY . .
   CMD ["sh","-c","uvicorn app.main:app --host 0.0.0.0 --port $PORT"]
   ```
2. Render → New → Web Service → connect the GitHub repo → root directory `backend/api`. Add env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SELFIE_BUCKET`, `RETENTION_DAYS`, `ALLOWED_ORIGINS`). Deploy → note the URL `https://cam-xxxx.onrender.com`.
3. In the **app's** `.env`, set `EXPO_PUBLIC_API_BASE_URL=https://cam-xxxx.onrender.com`, and add that origin to `ALLOWED_ORIGINS`.

> ⚠️ Render free services **sleep after ~15 min idle** (≈30 s cold start on the next request). Fine for a pilot. If it's annoying, ping `/health` every few minutes with a free cron (cron-job.org) during center hours.

### 9.2 App → real device build (when ready to leave Expo Go)
For the pilot you can keep using Expo Go. To hand testers an installable app, use EAS:
```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview   # produces an installable APK
```
iOS standalone builds need an Apple Developer account ($99/yr) — stay on Expo Go for iOS during the free pilot.

### ✅ Checkpoint 9
The app on your phone, pointed at the **Render URL** (not your Mac), completes a full check-in over mobile data — proving the deployed backend works end-to-end.

---

## Phase 10 — Hardening, privacy, pilot (M6)

This is **mandatory**, not optional — you're handling images of minors (`PROJECT_INSTRUCTIONS.md §9`).

- **RLS + API auth review:** confirm every endpoint requires a valid token and resolves a `teacher_accounts` row; admin-only routes reject non-admins. Confirm the `selfies` bucket is private (an anonymous URL fetch is denied).
- **Secrets check:** the `service_role` key must appear **only** in the backend. Verify it's not in the app bundle or git history.
- **Consent flow:** record **written parental/guardian consent** before any student's selfie is captured. Keep the consent records. Comply with the PH **Data Privacy Act (RA 10173)**: minimize data, secure it, honor deletion requests.
- **Retention purge:** schedule `POST /admin/purge-selfies` (the `retention_service` already exists) to delete selfies older than `RETENTION_DAYS` (90) while keeping the textual attendance log. Run it from a free GitHub Action or Render Cron daily.
- **Local cache hygiene:** clear the on-device selfie/queue cache after a successful sync.
- **Deletion path:** admin can delete a person and all their images on request.

### ✅ Checkpoint 10 (= Definition of Done, v1)
A teacher logs in, picks any person, checks them in/out with a **required selfie + automatic server timestamp**, sees today's board, views and exports history by date, and offline entries sync automatically — with RLS locking data to teachers, consent collected, and the retention purge scheduled.

---

## Phase 11 (later) — Grow into the full "Eye Level Dashboard"

Once v1 is solid, this is where CAM and your earlier Dashboard idea **merge**. Each is additive — you don't rewrite, you extend the same FastAPI + Supabase backend (and optionally add a small web view). Reference: `eyelevel-build-guide.md`, `V1__init.sql`.

| Add | What it means | New pieces |
|---|---|---|
| **Student self-clock-in** | Students clock in on their *own* phones via a saved token link/QR — no teacher needed at the door | `student_access_tokens` table; token issue/verify endpoints; a public `/s/:token` screen |
| **Owner-only enrollment** | Track monthly enrollment, level, tuition status per student/program — visible to *owner*, hidden from teachers | `programs`, `monthly_enrollments` tables; a third role (`owner`); owner-gated endpoints |
| **Audit trail** | Every edit to an attendance row is logged immutably | `time_entry_audit` table + a DB trigger |
| **Monthly reports** | Days-present per student, hours per teacher, enrollment counts | SQL views (`v_monthly_*`) |

When you do this, **reconcile the two schemas first** (CAM's `people`/`attendance` vs the Dashboard's `profiles`/`time_entries`) into one migration — don't run both. Ask for a `0002_*.sql` migration that extends CAM rather than replacing it.

---

## Appendix A — Daily development loop (once set up)

Three terminal tabs:
```bash
# Tab 1 — backend
cd backend/api && source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Tab 2 — app
cd app && npx expo start

# Tab 3 — git / general
```
Phone in Expo Go, same Wi-Fi. Edit → save → it hot-reloads.

## Appendix B — Beginner gotchas cheat-sheet

| Symptom | Cause | Fix |
|---|---|---|
| App can't reach backend ("network request failed") | Used `localhost` in the app's API URL | Use your Mac's LAN IP (`ipconfig getifaddr en0`); run uvicorn with `--host 0.0.0.0` |
| Works on Mac browser, not on phone | uvicorn bound to 127.0.0.1, or macOS firewall blocked it | `--host 0.0.0.0`; click **Allow** on the firewall prompt; phone + Mac on same Wi-Fi |
| Login "succeeds" but you're logged out on reload | Supabase client missing AsyncStorage / URL polyfill | Use the `supabaseClient.ts` config in 4.4 |
| `npm install <native pkg>` then red error screen | Native module version mismatch with Expo SDK | Use `npx expo install <pkg>` for native modules |
| 403 on every backend call | No `teacher_accounts` row for your auth user | Re-do the bootstrap insert (Phase 2.5) |
| First request after a day is very slow / fails | Supabase project paused or Render service asleep | Wait for resume; add a keep-warm ping during center hours |
| CORS error in logs | App origin not in `ALLOWED_ORIGINS` | Add the exact origin to the backend `.env`, restart uvicorn |

## Appendix C — Free-tier limits to respect

- **Supabase:** 500 MB DB, 1 GB storage (~10–20K compressed selfies), 50K monthly active users; pauses after ~7 days idle. → compress selfies, purge at 90 days.
- **Render free:** sleeps after ~15 min idle, limited monthly hours. → keep-warm ping during hours only.
- **EAS build:** limited free build minutes. → stay on Expo Go for the pilot; build only when shipping.

---

### Build order recap
0 setup → 1 git → 2 Supabase → 3 backend → 4 app+login → 5 roster → 6 capture → 7 today/history → 8 offline+export → 9 deploy → 10 hardening → 11 (later) Dashboard.
**Don't deploy (Phase 9) until the full flow works locally (through Phase 8).**
