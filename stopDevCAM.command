#!/bin/bash
# CAM — stop the dev environment (double-click in Finder, or: bash stopDevCAM.command)
# Kills the backend + expo servers, then checks for uncommitted work.

PROJECT="/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring"
cd "$PROJECT" || exit 1

# ── 1. Stop the servers ───────────────────────────────────────────────────
if pkill -f "uvicorn app.main:app"; then
  echo "✔ Backend (uvicorn) stopped"
else
  echo "• Backend was not running"
fi

if pkill -f "expo start"; then
  echo "✔ App server (expo) stopped"
else
  echo "• Expo was not running"
fi

# ── 2. Guard against losing work ──────────────────────────────────────────
echo
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️  Uncommitted changes:"
  git status -sb
  echo
  read -r -p "Commit and push now? (y/n) " ANSWER
  if [ "$ANSWER" = "y" ] || [ "$ANSWER" = "Y" ]; then
    read -r -p "Commit message: " MSG
    git add .
    git commit -m "${MSG:-wip: end of dev session}"
    git push && echo "✔ Pushed to GitHub"
  else
    echo "• Left uncommitted — remember to commit next session."
  fi
else
  # local clean; make sure it's also pushed
  if [ -n "$(git log origin/main..main --oneline 2>/dev/null)" ]; then
    read -r -p "Local commits not pushed. Push now? (y/n) " ANSWER
    if [ "$ANSWER" = "y" ] || [ "$ANSWER" = "Y" ]; then
      git push && echo "✔ Pushed to GitHub"
    fi
  else
    echo "✔ Git clean and pushed — nothing to save"
  fi
fi

# ── 3. Close the Terminal windows opened by startDevCAM ─────────────────
osascript <<'EOF' 2>/dev/null
tell application "Terminal"
  repeat with w in (every window whose name contains "CAM-")
    try
      close w
    end try
  end repeat
end tell
EOF

echo
echo "✅ Dev environment stopped and windows closed."
