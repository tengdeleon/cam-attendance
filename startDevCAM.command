#!/bin/bash
# CAM — start the dev environment (double-click in Finder, or: bash startDevCAM.command)
# Opens 3 Terminal windows: backend (uvicorn), app (expo), git.
# Also refreshes the LAN IP in app/.env so the phone can reach the backend.

PROJECT="/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring"
cd "$PROJECT" || exit 1

# ── 1. Detect current LAN IP and sync app/.env ────────────────────────────
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
EXPO_FLAGS=""
if [ -z "$IP" ]; then
  echo "⚠️  No LAN IP found (en0/en1). Are you connected to Wi-Fi/hotspot?"
  echo "   Continuing anyway — the phone won't reach the backend until you fix app/.env."
else
  CURRENT=$(grep -o 'http://[0-9.]*:8000' app/.env 2>/dev/null)
  if [ "$CURRENT" != "http://$IP:8000" ]; then
    sed -i '' "s|EXPO_PUBLIC_API_BASE_URL=.*|EXPO_PUBLIC_API_BASE_URL=http://$IP:8000|" app/.env
    echo "🔄 IP changed → app/.env updated to http://$IP:8000 (expo will start with -c)"
    EXPO_FLAGS="-c"
  else
    echo "✔ LAN IP unchanged ($IP)"
  fi
fi

# ── 2. Open the three Terminal windows ────────────────────────────────────
osascript <<EOF
tell application "Terminal"
  activate
  set t1 to do script "cd \"$PROJECT/backend/api\" && source .venv/bin/activate && echo '── CAM BACKEND ──' && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
  set custom title of t1 to "CAM-BACKEND"
  set t2 to do script "cd \"$PROJECT/app\" && echo '── CAM APP (scan QR with Expo Go) ──' && npx expo start $EXPO_FLAGS"
  set custom title of t2 to "CAM-APP"
  set t3 to do script "cd \"$PROJECT\" && echo '── CAM GIT ──' && git status -sb"
  set custom title of t3 to "CAM-GIT"
end tell
EOF

echo
echo "✅ Dev environment launching. Checklist:"
echo "   • Phone on the SAME network as this Mac ($IP)"
echo "   • Scan the QR in the 'CAM APP' window with Expo Go"
echo "   • Backend docs: http://localhost:8000/docs"
