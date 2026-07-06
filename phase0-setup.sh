#!/bin/bash
# CAM Phase 0 — macOS toolchain setup (idempotent: safe to re-run)
# Usage:  bash phase0-setup.sh
set -u

ok()   { printf "  \033[32m✔\033[0m %s\n" "$1"; }
skip() { printf "  \033[33m•\033[0m %s (already installed)\n" "$1"; }
fail() { printf "  \033[31m✘\033[0m %s\n" "$1"; FAILED=1; }
FAILED=0

echo "== 1/6 Xcode Command Line Tools =="
if xcode-select -p >/dev/null 2>&1; then
  skip "CLT"
else
  xcode-select --install
  echo "  → A GUI installer opened. Finish it, then RE-RUN this script."
  exit 0
fi

echo "== 2/6 Homebrew =="
if command -v brew >/dev/null 2>&1; then
  skip "brew $(brew --version | head -1)"
else
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || { fail "Homebrew install"; exit 1; }
fi
# make brew usable in this shell (Apple Silicon vs Intel)
if [ -x /opt/homebrew/bin/brew ]; then BREW_PREFIX=/opt/homebrew; else BREW_PREFIX=/usr/local; fi
eval "$($BREW_PREFIX/bin/brew shellenv)"
# persist for future shells
grep -q 'brew shellenv' ~/.zprofile 2>/dev/null || \
  echo "eval \"\$($BREW_PREFIX/bin/brew shellenv)\"" >> ~/.zprofile

echo "== 3/6 Node via nvm =="
brew list nvm >/dev/null 2>&1 || brew install nvm
mkdir -p ~/.nvm
grep -q 'NVM_DIR' ~/.zshrc 2>/dev/null || {
  echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
  echo '[ -s "$(brew --prefix nvm)/nvm.sh" ] && . "$(brew --prefix nvm)/nvm.sh"' >> ~/.zshrc
}
export NVM_DIR="$HOME/.nvm"
. "$(brew --prefix nvm)/nvm.sh"
if command -v node >/dev/null 2>&1 && [ "$(node -v | cut -c2-3)" -ge 20 ] 2>/dev/null; then
  skip "node $(node -v)"
else
  nvm install --lts && nvm alias default 'lts/*'
fi

echo "== 4/6 Watchman =="
brew list watchman >/dev/null 2>&1 && skip "watchman" || brew install watchman

echo "== 5/6 Python 3.12 =="
brew list python@3.12 >/dev/null 2>&1 && skip "python@3.12" || brew install python@3.12

echo "== 6/6 VS Code =="
if [ -d "/Applications/Visual Studio Code.app" ]; then
  skip "VS Code"
else
  brew install --cask visual-studio-code
fi

echo
echo "== ✅ Checkpoint 0 =="
for c in "git --version" "node -v" "npm -v" "watchman --version" "python3.12 --version"; do
  out=$($c 2>/dev/null) && ok "$c → $out" || fail "$c"
done

echo
if [ "$FAILED" -eq 0 ]; then
  echo "Checkpoint 0 PASSED (tools). Remaining manual items:"
else
  echo "Some checks FAILED — open a NEW terminal tab and re-run: bash phase0-setup.sh"
fi
cat <<'EOF'
  [ ] Install Expo Go on your phone (App Store / Play Store)
  [ ] Phone on the SAME Wi-Fi as this Mac
  [ ] Free accounts: github.com, supabase.com, expo.dev, render.com
Then proceed to Phase 1 (git init + push) in BUILD-GUIDE.md.
EOF
