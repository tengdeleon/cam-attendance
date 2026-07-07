#!/usr/bin/env python3
"""Provision a teacher login from the command line (uses the service-role key in .env).

Run this from a machine that can reach Supabase (not the Cowork sandbox — its
egress proxy blocks the Supabase host). No admin JWT needed; this calls the same
teacher_service the API uses.

Usage:
    cd backend/api
    python provision_teacher.py --full-name "Kristian Bagatsing" \
        --email kristian.bagatsing@gmail.com --password "John 3:16-17"
    # add --admin to make them an admin
"""
import argparse
import sys

from app.models.schemas import TeacherIn
from app.services import teacher_service


def main() -> int:
    p = argparse.ArgumentParser()
    # nargs="+" lets the name be passed unquoted (multiple words); we join + de-quote.
    p.add_argument("--full-name", required=True, nargs="+")
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--admin", action="store_true")
    a = p.parse_args()

    def clean(s: str) -> str:
        # strip stray straight/curly quotes that an editor may have inserted
        return s.strip().strip("\"'“”‘’")

    full_name = clean(" ".join(a.full_name))
    body = TeacherIn(
        full_name=full_name,
        email=clean(a.email),
        password=a.password,
        is_admin=a.admin,
    )
    try:
        out = teacher_service.provision_teacher(body)
    except Exception as e:  # HTTPException or SDK error
        detail = getattr(e, "detail", str(e))
        print(f"FAILED: {detail}", file=sys.stderr)
        return 1
    print("CREATED:")
    print(out.model_dump_json(indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
