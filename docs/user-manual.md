# CAM Teacher User Manual

How to use the CAM mobile app to log attendance at the center. This is the **teacher
how-to**; for install/setup see `docs/teacher-install-guide.md`. Maintained by the
`cam-user-manual-manager` agent — every feature that ships updates this file.

Last updated: 2026-07-08 (baseline).

---

## 1. Before you start

- You need a teacher account (email + password). Only teachers and admins log in;
  students never use the app.
- Point your phone's camera when prompted — a selfie is **required** to record any
  check-in or check-out. No selfie, no record.
- Some actions (adding people, changing center settings) are **admin-only**. If you don't
  see them, your account isn't an admin.
- **Consent first:** never capture a student's selfie without written parental/guardian
  consent on file.

---

## 2. Logging in

1. Open the CAM app.
2. Enter your email and password.
3. Tap **Sign in**. You land on the Check-In screen.

If sign-in fails, check your connection and that your email is registered. Passwords are
managed by an admin.

---

## 3. Checking a person in or out (with selfie)

This is the main daily task.

1. On the **Check-In** screen, search for the person by name. You can filter by teacher or
   student.
2. Tap the person.
3. Choose **Check In** or **Check Out**. The app suggests the likely direction based on
   their last record, but you can override it.
4. The front camera opens. Take a clear selfie of the person at the entrance and confirm.
5. The record saves with an automatic timestamp set by the server (the official time).

**What the app will stop you from doing (and why):**

- **Already checked in today?** A second check-in is rejected with a message like
  "Already checked in today at 08:00." — check them *out* instead.
- **Not checked in yet?** A check-out is rejected with "No open check-in today; check in
  first."
- **Forgot to check out yesterday?** Today's check-in still works, but you'll see a notice
  like "No check-out recorded on 2026-07-07." That missed day stays flagged in reports —
  you cannot back-fill yesterday's check-out.

---

## 4. Working offline

If the network is down when you capture attendance, the app **queues** the entry (with its
selfie) and marks it pending. When you're back online it syncs automatically — you don't
need to do anything.

- If a queued entry is rejected on sync (for example, the person was already checked in by
  the time it replayed), the app shows a visible notice naming the rejected entry so it
  never disappears silently.
- You can review entries that failed to sync on the **Failed Queue** screen and retry or
  clear them.

---

## 5. Today's board

The **Today** screen shows who is currently in and who is out, live for the current day
(Manila time). Use it for a quick roll-call at any point in the day.

Tap any row to see the **selfie** captured for that check-in/out, so you can visually
verify the log is the right person.

---

## 6. History and selfie review

The **History** screen lists past attendance records. Filter by date to find a specific
day. Tap a row to view the selfie captured at that moment — the image loads on demand and
is not stored on your phone. Re-opening fetches it fresh.

---

## 7. Reports and export

Two ways to get attendance out of the app:

- **Export (CSV):** from the reports area, pick a date range and export a CSV of records to
  share.
- **Period report:** the **Period Report** screen summarizes a month. Pick the month and a
  period — first half (1st–15th), second half (16th–end of month), or the full month.
  Each teacher's row shows days present, late days, late minutes, and **missed checkouts**.
  Lateness is measured against the center's official start time and grace minutes. You can
  export this report as CSV too.

---

## 8. Managing people (admin only)

Admins manage the roster from the **Roster** screens:

1. Open **Roster** to browse or search all people (teachers and students).
2. Tap **Add** to create a person — enter their name and role (teacher or student).
3. Tap a person to edit their details, or deactivate them if they've left the center.
   Deactivating keeps their past attendance records intact.

---

## 9. Center settings (admin only)

Admins set the center's official **opening time** and **grace minutes** (how many minutes
after opening still counts as on-time). These drive the late-day and late-minute math in
the period report.

---

## 10. Privacy reminders for everyone

- Selfies of students are sensitive personal data of minors. Only capture them with consent
  on file.
- The app doesn't keep selfies on your phone longer than needed to sync.
- Old selfies are purged on a retention schedule; the textual attendance log is kept.
- If a parent asks to have a child's images removed, tell an admin — there's an admin path
  to delete a person and their images.
