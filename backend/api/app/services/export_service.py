"""CSV export of attendance history."""
import csv
import io
from datetime import date

from app.db import get_supabase


def history_csv(start: date, end: date) -> str:
    sb = get_supabase()
    res = (
        sb.table("attendance")
        .select("server_time, direction, people(full_name, role)")
        .gte("server_time", f"{start}T00:00:00Z")
        .lte("server_time", f"{end}T23:59:59Z")
        .order("server_time")
        .execute()
    )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["timestamp_utc", "name", "role", "direction"])
    for r in res.data or []:
        w.writerow([r["server_time"], r["people"]["full_name"], r["people"]["role"], r["direction"]])
    return buf.getvalue()
