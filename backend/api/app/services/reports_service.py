"""Period report and center-settings service."""
import calendar
import csv
import io
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status

from app.services.attendance_service import manila_day_bounds

MANILA = ZoneInfo("Asia/Manila")
_VALID_PERIODS = {"h1", "h2", "full"}


def _parse_month(month: str) -> date:
    try:
        return datetime.strptime(month, "%Y-%m").date()
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Invalid month: {month!r}")


def _period_window(month_date: date, period: str) -> tuple[date, date]:
    if period not in _VALID_PERIODS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "period must be one of: h1, h2, full",
        )
    year, month = month_date.year, month_date.month
    last_day = calendar.monthrange(year, month)[1]
    if period == "h1":
        return date(year, month, 1), date(year, month, 15)
    elif period == "h2":
        return date(year, month, 16), date(year, month, last_day)
    else:
        return date(year, month, 1), date(year, month, last_day)


def _period_label(month: str, period: str) -> str:
    return {"h1": f"H1 {month}", "h2": f"H2 {month}", "full": f"Full {month}"}[period]


def get_center_settings(sb) -> dict:
    res = sb.table("center_settings").select("open_time,grace_minutes,tz").eq("id", 1).single().execute()
    if not res.data:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "center_settings not initialised")
    return res.data


def update_center_settings(sb, patch: dict) -> dict:
    if "grace_minutes" in patch and patch["grace_minutes"] < 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "grace_minutes must be >= 0")
    if "open_time" in patch:
        try:
            time.fromisoformat(patch["open_time"])
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "open_time must be HH:MM:SS")
    if "tz" in patch:
        try:
            ZoneInfo(patch["tz"])
        except (ZoneInfoNotFoundError, KeyError):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown timezone: {patch['tz']!r}")
    sb.table("center_settings").update(patch).eq("id", 1).execute()
    return get_center_settings(sb)


def period_report(sb, month: str, period: str) -> list[dict]:
    month_date = _parse_month(month)
    start, end = _period_window(month_date, period)
    lo, hi = manila_day_bounds(start, end)

    settings = get_center_settings(sb)
    open_time = time.fromisoformat(settings["open_time"])
    grace_minutes = settings["grace_minutes"]

    res = (
        sb.table("attendance")
        .select("person_id, direction, server_time, people(full_name, role)")
        .gte("server_time", lo)
        .lt("server_time", hi)
        .order("server_time", desc=False)
        .execute()
    )

    by_person: dict[str, dict] = {}
    person_days: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))

    for r in res.data or []:
        person = r.get("people") or {}
        if person.get("role") != "teacher":
            continue
        pid = r["person_id"]
        if pid not in by_person:
            by_person[pid] = {"person_id": pid, "full_name": person.get("full_name", "")}
        dt = datetime.fromisoformat(r["server_time"])
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("UTC"))
        local_dt = dt.astimezone(MANILA)
        person_days[pid][local_dt.date().isoformat()].append((local_dt, r["direction"]))

    result = []
    for pid, info in by_person.items():
        days_present = late_days = total_late_minutes = missed_checkouts = 0
        daily_detail = []

        for day_str in sorted(person_days[pid]):
            events = person_days[pid][day_str]
            ins = [dt for dt, d in events if d == "in"]
            if not ins:
                continue
            days_present += 1

            first_in_dt = min(ins)
            first_in_time = first_in_dt.time().replace(tzinfo=None)

            late_minutes = 0
            open_dt = datetime.combine(date.min, open_time)
            first_dt = datetime.combine(date.min, first_in_time)
            if first_in_time > open_time:
                raw_late = int((first_dt - open_dt).total_seconds() / 60)
                late_minutes = max(0, raw_late - grace_minutes)
            if late_minutes > 0:
                late_days += 1
                total_late_minutes += late_minutes

            missed = events[-1][1] == "in"
            if missed:
                missed_checkouts += 1

            daily_detail.append({
                "date": day_str,
                "first_in": first_in_dt.strftime("%H:%M:%S"),
                "late_minutes": late_minutes,
                "missed_checkout": missed,
            })

        result.append({
            **info,
            "days_present": days_present,
            "late_days": late_days,
            "total_late_minutes": total_late_minutes,
            "missed_checkouts": missed_checkouts,
            "daily_detail": daily_detail,
        })

    return result


def period_report_csv(sb, month: str, period: str) -> str:
    rows = period_report(sb, month, period)
    label = _period_label(month, period)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["teacher_name", "period", "days_present", "late_days", "total_late_minutes", "missed_checkouts"])
    for r in rows:
        writer.writerow([r["full_name"], label, r["days_present"], r["late_days"], r["total_late_minutes"], r["missed_checkouts"]])
    return out.getvalue()
