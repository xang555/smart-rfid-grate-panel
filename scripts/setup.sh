#!/usr/bin/env bash
# Installer driven by the panel's setup screen. Progress is reported back to
# the UI through "@@STEP:<name>:<start|ok|fail>" markers on stdout.
set -euo pipefail

step() { echo "@@STEP:$1:$2"; }

PROJECT_PATH="${PROJECT_PATH:-$HOME/Desktop/asean-project}"
DOCKER_USER="${DOCKER_USER:?DOCKER_USER required}"

step update start
sudo apt update && sudo apt upgrade -y
step update ok

step docker start
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
fi
step docker ok

step download start
mkdir -p "$PROJECT_PATH"
cd "$PROJECT_PATH"
curl -fL -o asian-pj.zip "https://github.com/${DOCKER_USER}/asean-project/releases/latest/download/asian-pj.zip"
step download ok

step extract start
unzip -o asian-pj.zip -d "$PROJECT_PATH"
step extract ok

step syncthing start
if ! command -v syncthing >/dev/null 2>&1; then
  sudo apt install -y syncthing
fi
step syncthing ok

step login start
echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USER" --password-stdin
step login ok

echo "Setup complete at $PROJECT_PATH"
