# Eye Level Dashboard — Step-by-Step Build Guide

Companion to `eyelevel-dashboard-build-plan.md` (architecture/decisions) and `V1__init.sql` (schema).
Stack locked: **Supabase** (Postgres + Auth + Storage) · **Spring Boot** API (Koyeb, kept warm) · **React PWA** (Cloudflare Pages). All free tiers.

Follow in order. Each part ends with a **✅ Checkpoint** — don't proceed until it passes.

---

## Part 0 — Prerequisites (one-time)

**Install locally:**
- Java 17 (`sdk install java 17-tem` via SDKMAN, or Temurin)
- Maven 3.9+ (or use the Maven wrapper generated later)
- Node 20+ and npm
- Docker Desktop (local Postgres for dev)
- Git
- A code editor (IntelliJ IDEA Community is free and best for Spring Boot)

**Create free accounts:**
- GitHub
- Supabase (supabase.com)
- Koyeb (koyeb.com) — backend host
- Cloudflare (Pages) — frontend host
- cron-job.org — keep-warm pinger

**✅ Checkpoint:** `java -version` shows 17, `node -v` shows 20+, `docker ps` works, `git --version` works.

---

## Part 1 — Repository & layout

```bash
mkdir eyelevel-dashboard && cd eyelevel-dashboard
git init
mkdir backend frontend db ops
cp /path/to/V1__init.sql db/V1__init.sql
printf "target/\nnode_modules/\n.env\n*.env\ndist/\n.idea/\n" > .gitignore
git add . && git commit -m "chore: repo skeleton"
```

Final shape:
```
eyelevel-dashboard/
├── backend/    # Spring Boot API
├── frontend/   # React PWA
├── db/         # SQL migrations (V1__init.sql, later V2..)
└── ops/        # backup + purge scripts, cron configs
```

Create a GitHub repo and push:
```bash
git remote add origin git@github.com:<you>/eyelevel-dashboard.git
git push -u origin main
```

**✅ Checkpoint:** repo on GitHub with the four folders.

---

## Part 2 — Supabase (database, auth, storage)

1. **Create project** in Supabase dashboard. Region: pick closest (Singapore). Save the DB password.
2. **Run the migration:** dashboard → SQL Editor → paste `V1__init.sql` → Run. Confirm tables appear under Table Editor (`profiles`, `students`, `programs`, `student_access_tokens`, `monthly_enrollments`, `time_entries`, `time_entry_audit`) and the `Math`/`English` seed rows in `programs`.
3. **Create the storage bucket:** Storage → New bucket → name `selfies` → **Private** (not public). Selfies are minors' data; access goes through the API only.
4. **Collect secrets** (Settings → API and Settings → Database):
   - `Project URL` (e.g. `https://xxxx.supabase.co`)
   - `anon` public key (frontend)
   - `service_role` key (**backend only — never ship to the browser**)
   - `JWT Secret` (Settings → API → JWT Settings) — backend verifies tokens with this
   - Postgres connection string (host, db, user, password)
5. **Create your owner account:** Authentication → Users → Add user → your email/password. Then in SQL Editor:
   ```sql
   insert into public.profiles (id, full_name, role)
   select id, 'Teng De Leon', 'owner' from auth.users where email = 'tengdeleon@gmail.com';
   ```

**✅ Checkpoint:** you can log in via Supabase Auth, and `select * from profiles` shows your owner row.

---

## Part 3 — Backend (Spring Boot API)

### 3.1 Scaffold
Generate at start.spring.io (or `spring init`) with dependencies:
`Spring Web`, `Spring Security`, `Spring Data JPA`, `PostgreSQL Driver`, `Validation`, `OAuth2 Resource Server` (for JWT).

```bash
cd backend
# unzip the generated project here, then:
./mvnw -q -DskipTests package   # confirms it builds
```

### 3.2 Configuration — `src/main/resources/application.yml`
```yaml
spring:
  datasource:
    url: ${DB_URL}          # jdbc:postgresql://<host>:5432/postgres
    username: ${DB_USER}
    password: ${DB_PASSWORD}
  jpa:
    hibernate.ddl-auto: validate   # schema is owned by V1__init.sql, never auto-gen
    properties.hibernate.jdbc.time_zone: UTC

supabase:
  url: ${SUPABASE_URL}
  service-role-key: ${SUPABASE_SERVICE_ROLE_KEY}
  jwt-secret: ${SUPABASE_JWT_SECRET}
  storage-bucket: selfies

server:
  port: ${PORT:8080}
```
Keep secrets in a local `.env` (gitignored); set the same as environment variables in Koyeb later.

### 3.3 JWT verification (Spring Security)
Supabase signs JWTs (HS256) with the JWT secret. Configure a resource server with a symmetric key:
```java
@Configuration
@EnableWebSecurity
class SecurityConfig {
  @Value("${supabase.jwt-secret}") String jwtSecret;

  @Bean SecurityFilterChain chain(HttpSecurity http) throws Exception {
    http.csrf(c -> c.disable())
        .authorizeHttpRequests(a -> a
            .requestMatchers("/health", "/student/**").permitAll() // student = token, not JWT
            .anyRequest().authenticated())
        .oauth2ResourceServer(o -> o.jwt(j -> j.decoder(jwtDecoder())));
    return http.build();
  }
  @Bean JwtDecoder jwtDecoder() {
    var key = new javax.crypto.spec.SecretKeySpec(jwtSecret.getBytes(), "HmacSHA256");
    return NimbusJwtDecoder.withSecretKey(key).build();
  }
}
```
Map the JWT `sub` claim → `profiles.id`. Add a small service that loads the caller's role and exposes `isOwner()`.

### 3.4 Entities & repositories
Create JPA `@Entity` classes mirroring the tables (Profile, Student, Program, StudentAccessToken, MonthlyEnrollment, TimeEntry). Use `@Enumerated`/`String` for the check-constrained text columns. Repositories: standard `JpaRepository`. Add custom queries for the views (or map the views as read-only `@Entity`/`@Immutable`).

### 3.5 Controllers (match the API in the plan)
- `MeController` — `GET /me`
- `StudentController` — students CRUD; `POST /students/{id}/token` issues a token (below)
- `ClockController` — teacher `POST /clock-in` / `/clock-out` (subject from JWT)
- `StudentClockController` — `POST /student/clock-in` / `/clock-out` (subject from device token)
- `AttendanceController` — `GET /attendance/monthly`
- `EnrollmentController` — **owner-only**; annotate every method `@PreAuthorize("@auth.isOwner()")`
- `HealthController` — `GET /health` returns 200 (used by keep-warm)

### 3.6 Student device token (the no-account flow)
**Issue** (`POST /students/{id}/token`, staff only):
```java
String raw = base64url(secureRandom(32));      // shown once, encoded into a QR/link
String hash = sha256Hex(raw);
tokenRepo.save(new StudentAccessToken(studentId, hash));
return Map.of("clockUrl", frontendUrl + "/s/" + raw);  // student saves this link
```
**Verify** on `POST /student/clock-in`:
```java
String hash = sha256Hex(req.token());
var tok = tokenRepo.findActiveByHash(hash).orElseThrow(() -> new Forbidden());
UUID studentId = tok.getStudentId();           // resolved server-side; client never sends it
tok.setLastUsedAt(Instant.now());
// ...proceed to selfie upload + insert time_entries
```

### 3.7 Selfie upload + clock logic
On any clock-in:
1. Reject if subject already has an `open` entry (DB unique index will also enforce).
2. Upload the multipart image to Supabase Storage via REST using the **service-role key**:
   `POST {SUPABASE_URL}/storage/v1/object/selfies/{type}/{id}/{epoch}.jpg`
   header `Authorization: Bearer {service_role_key}`, body = bytes.
3. Insert `time_entries` with `clock_in_at = now()` (server time) and the storage path.
Clock-out: find the open entry, set `clock_out_at`, `out_selfie_path`, status `closed`.

> Because student writes use the service-role key, they bypass RLS by design — but only **after** the token check has resolved a valid `student_id`.

### 3.8 Run locally against Docker Postgres
`db/docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:15
    environment: { POSTGRES_PASSWORD: dev, POSTGRES_DB: eyelevel }
    ports: ["5432:5432"]
```
```bash
docker compose -f db/docker-compose.yml up -d
# apply schema locally (auth.* stubs needed for FKs — or point at Supabase for full auth)
psql postgresql://postgres:dev@localhost:5432/eyelevel -f db/V1__init.sql
cd backend && DB_URL=jdbc:postgresql://localhost:5432/eyelevel DB_USER=postgres DB_PASSWORD=dev ./mvnw spring-boot:run
```
For full auth testing, point `DB_URL`/secrets at your Supabase project instead of local Docker.

**✅ Checkpoint:** `GET /health` → 200; `GET /me` with your Supabase JWT returns your owner profile; `GET /enrollment/monthly` as a teacher token returns 403.

---

## Part 4 — Frontend (React PWA)

### 4.1 Scaffold
```bash
cd ../frontend
npm create vite@latest . -- --template react
npm i
npm i @supabase/supabase-js react-router-dom
npm i -D tailwindcss postcss autoprefixer vite-plugin-pwa
npx tailwindcss init -p
```
Configure Tailwind `content` to `./index.html` and `./src/**/*.{js,jsx}`; add the `@tailwind` directives to `src/index.css`.

### 4.2 PWA + env
`vite.config.js`: add `VitePWA({ registerType: 'autoUpdate', manifest: {...} })`.
`.env`:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_API_BASE=https://<your-koyeb-app>/   # backend URL
```

### 4.3 Auth + API client
- `lib/supabase.js`: `createClient(url, anonKey)`.
- Login screen for teachers/owner (`supabase.auth.signInWithPassword`).
- `lib/api.js`: fetch wrapper that attaches `Authorization: Bearer ${session.access_token}` on every call to `VITE_API_BASE`.

### 4.4 Routing — three surfaces
```
/login              -> teacher/owner login
/app                -> authed shell; tabs: Roster | Attendance | (Enrollment if owner)
/app/clock          -> teacher clocks self in/out
/s/:token           -> STUDENT surface (no login): name + Clock In/Out + selfie
```
Gate the Enrollment tab on `role === 'owner'` (and the API enforces it too).

### 4.5 Camera + selfie capture (shared component)
```jsx
const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
// draw current frame to a <canvas>, then:
canvas.toBlob(blob => upload(blob), 'image/jpeg', 0.6);   // ~50–100 KB
```
Downscale to ≤720px before `toBlob` to protect the 1 GB Storage cap. Send as `multipart/form-data` to the clock endpoint (teacher: with JWT; student: with the `:token` from the URL).

### 4.6 Run locally
```bash
npm run dev   # http://localhost:5173, talking to local backend
```

**✅ Checkpoint:** log in as owner; clock yourself in (selfie appears in Supabase Storage); open a `/s/:token` link in a second browser/phone and clock a test student in; Enrollment tab visible to owner, hidden to a teacher account.

---

## Part 5 — Local end-to-end test

1. Owner creates a teacher account (Supabase → add user; insert `profiles` row role `teacher`).
2. Owner adds a few students; issue a token per student → get `/s/:token` links.
3. Teacher logs in on phone (or browser), clocks in.
4. Student opens their link, clocks in/out.
5. Owner sets monthly enrollment rows for the current month.
6. Check `v_monthly_student_attendance` and `v_monthly_enrollment_counts` return sensible numbers.

**✅ Checkpoint:** attendance days and enrollment counts match what you entered; teacher cannot reach enrollment data (UI hidden + API 403).

---

## Part 6 — Deploy the backend (Koyeb + keep-warm)

1. **Containerize** — add a `Dockerfile` to `backend/`:
   ```dockerfile
   FROM eclipse-temurin:17-jre
   COPY target/*.jar app.jar
   ENV JAVA_TOOL_OPTIONS="-Xmx300m -XX:+UseSerialGC"   # fit the 512MB free box
   ENTRYPOINT ["java","-jar","/app.jar"]
   ```
2. `./mvnw -DskipTests package` then push to GitHub.
3. **Koyeb** → Create Service → from GitHub repo (`/backend`) → Dockerfile build. Set env vars: `DB_URL`, `DB_USER`, `DB_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `PORT=8080`. Use the **Supabase** DB connection here (not local Docker).
4. Deploy; note the public URL (e.g. `https://eyelevel-xxxx.koyeb.app`).
5. **Keep-warm:** cron-job.org → new job → `GET https://<koyeb-url>/health` every 10 minutes, 6am–9pm Manila. Prevents the 30s cold start during center hours.

**✅ Checkpoint:** hitting `/health` on the Koyeb URL returns 200 within ~1s after the warm-up.

---

## Part 7 — Deploy the frontend (Cloudflare Pages)

1. Cloudflare → Pages → Connect to Git → select repo, root `/frontend`.
2. Build command `npm run build`, output dir `dist`.
3. Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE=https://<koyeb-url>/`.
4. Deploy → get `https://eyelevel.pages.dev` (or attach a custom domain).
5. **CORS:** in the backend, allow the Pages origin (`@CrossOrigin` / global CORS config) for the API.

**✅ Checkpoint:** the live Pages URL logs in, clocks in/out, and student `/s/:token` links work from a real phone over mobile data.

---

## Part 8 — Operational jobs (free, scheduled)

All via **GitHub Actions** (free) in `.github/workflows/`:

**Weekly backup** (`backup.yml`): `pg_dump` the Supabase DB to an artifact / private store, Sundays.
```yaml
on: { schedule: [{ cron: '0 18 * * 0' }] }   # Sun 18:00 UTC = Mon 02:00 Manila
jobs:
  dump:
    runs-on: ubuntu-latest
    steps:
      - run: pg_dump "${{ secrets.SUPABASE_DB_URL }}" | gzip > backup.sql.gz
      - uses: actions/upload-artifact@v4
        with: { name: db-backup, path: backup.sql.gz, retention-days: 30 }
```

**Selfie purge** (`purge.yml`, daily): delete Storage objects older than 90 days and null the `*_selfie_path` columns. Implement as a small script hitting the Storage REST API + an `UPDATE` over `time_entries` where `clock_in_at < now() - interval '90 days'`.

**Monthly enrollment rollover** (optional, 1st of month): copy last month's `enrolled` students into the new `period_month` as a starting draft for the owner to adjust.

**✅ Checkpoint:** trigger each workflow manually once (`workflow_dispatch`) and confirm it succeeds.

---

## Part 9 — Testing & verification

- **Backend unit/slice tests:** JWT filter (valid/invalid/expired), owner-only `@PreAuthorize` returns 403 for teacher, token verify rejects revoked/unknown hashes, double-clock-in rejected.
- **DB constraints:** attempt a second `open` entry for one person → expect unique-index violation; insert a `time_entries` row with both teacher_id and student_id → expect `one_subject` violation.
- **Manual security pass:** confirm the **service-role key is not present in the frontend bundle** (`grep -r service_role frontend/dist` → nothing); confirm `selfies` bucket is private (anonymous URL fetch → denied).
- **Privacy:** guardian consent recorded before issuing a student token; purge job verified to actually remove objects.

**✅ Checkpoint:** all of the above pass; no secrets in the client bundle.

---

## Part 10 — Portfolio packaging

- Top-level `README.md`: problem, architecture diagram, the **cold-start → keep-warm** decision, the **no-account student token** design, screenshots.
- Public demo seeded with **fake/anonymized** data only — never real minors' data.
- 2–3 min walkthrough video.
- Pin the repo; in your CV frame it as: *full-stack (Spring Boot + React PWA), role-based access control, token-based device auth, audited time tracking, CI/CD on free infra.*

---

## Suggested build order (recap)
Part 0 → 1 → 2 (Supabase + schema) → 3 (backend, local) → 4 (frontend, local) → 5 (E2E local) → 6 (deploy backend) → 7 (deploy frontend) → 8 (ops jobs) → 9 (tests) → 10 (package).
Roughly the six weekends in the build plan. Don't deploy (Parts 6–7) until Part 5 passes locally.
