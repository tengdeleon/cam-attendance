# CAM — Privacy & Retention Policy

Applies to the Center Attendance Monitoring app operated by Eye Level Dasmariñas.
Legal basis: Philippines Data Privacy Act of 2012 (RA 10173) and its IRR.
Last updated: 2026-07-07.

## What we collect and why

The app records, for each entry/exit at the center: the person's name and role,
the direction (in/out), a timestamp, the identity of the teacher who logged it,
and a photograph ("selfie") taken at the door. The sole purpose is attendance
verification — confirming that the named person was physically present. The
photo is used for human verification only; no facial-recognition or automated
matching is performed.

## Consent

A parent or legal guardian must sign the written consent form
(`docs/parental-consent-form.docx`) before any student's photo is captured.
Signed forms are kept on file at the center for as long as the student is
enrolled plus one year. Teachers consent through their employment/engagement
agreement and account setup. A student without consent on file must not be
photographed; their attendance may be logged manually outside the app.

## Storage and security

Data is stored in a Supabase (Postgres) database and a **private** storage
bucket, encrypted at rest and in transit (HTTPS). Photos are never publicly
accessible; the app displays them only through short-lived signed URLs. Access
requires an authenticated teacher account; roster changes and deletions require
an admin account. Database row-level security restricts all tables to
authenticated teacher accounts. Server credentials exist only on the API
server, never on phones. Photos are removed from the capturing device
immediately after upload (or after offline sync).

## Retention

- **Photos:** deleted automatically after **90 days** (`RETENTION_DAYS`) by a
  scheduled daily purge. The textual attendance record (name, direction,
  timestamp) is kept without the photo.
- **Attendance records:** kept for the current and previous school year, then
  reviewed for deletion.
- **Consent forms:** enrollment period + 1 year.

## Rights of data subjects

Parents/guardians (for minors) and adult data subjects may: request a copy of
the data held about them; correct inaccurate data; withdraw consent (stops
future photo capture); and request **erasure**. Erasure requests are honored
via the app's admin "Erase permanently" action, which deletes the person, all
their attendance rows, and every stored photo. Direct requests to the center
in person or in writing.

## Contact

Data protection contact: the Center Director / Franchisee, Eye Level
Dasmariñas. Complaints may also be raised with the National Privacy
Commission (privacy.gov.ph).
