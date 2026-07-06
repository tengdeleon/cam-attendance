"""CSV export of attendance history (Manila-local days and times)."""
import csv
import io
from datetime import date, datetime

from app.db import get_supabase
from app.services.attendance_service import MANILA, manila_day_bounds


def _teacher_names(sb, account_ids: set[str]) -> dict[str, str]:
    """Map teacher_account id -> teacher's full name."""
    if not account_ids:
        return {}
    res = (
        sb.table("teacher_accounts")
        .select("id, people(full_name)")
        .in_("id", list(account_ids))
        .execute()
    )
    return {r["id"]: r["people"]["full_name"] for r in res.data or []}


def history_csv(start: date, end: date) -> str:
    sb = get_supabase()
    lo, hi = manila_day_bounds(start, end)
    res = (
        sb.table("attendance")
        .select("server_time, direction, logged_by, people(full_name, role)")
        .gte("server_time", lo)
        .lt("server_time", hi)
        .order("server_time")
        .execute()
    )
    rows = res.data or []
    teachers = _teacher_names(sb, {r["logged_by"] for r in rows if r.get("logged_by")})

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "time", "name", "role", "direction", "logged_by"])
    for r in rows:
        # Python 3.10's fromisoformat can't parse a trailing 'Z'
        ts = datetime.fromisoformat(r["server_time"].replace("Z", "+00:00")).astimezone(MANILA)
        w.writerow(
            [
                ts.strftime("%Y-%m-%d"),
                ts.strftime("%H:%M:%S"),
                r["people"]["full_name"],
                r["people"]["role"],
                r["direction"],
                teachers.get(r.get("logged_by"), ""),
            ]
        )
    return buf.getvalue()
