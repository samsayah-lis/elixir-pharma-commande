#!/bin/bash
# Installe l'agent PharmaML comme service macOS (LaunchAgent) : démarrage à l'ouverture de session,
# relance automatique en cas d'arrêt. Désinstaller : ./installer-service.command --retirer
set -e
cd "$(dirname "$0")"
DIR="$(pwd)"
LABEL="fr.elixirpharma.agent-pharmaml"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || echo /usr/local/bin/node)"
if [ "$1" = "--retirer" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Service retiré."
  exit 0
fi
[ -f .env ] || { echo "✗ .env absent : copiez .env.example en .env et mettez-y le mot de passe PharmaML."; exit 1; }
# ancien agent lancé à la main (port 3001) : arrêté pour ne laisser que le service
PIDS=$(lsof -ti:3001 2>/dev/null || true)
[ -n "$PIDS" ] && { echo "Arrêt de l'agent lancé à la main ($PIDS)…"; kill $PIDS 2>/dev/null || true; sleep 1; }
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/agent.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$DIR/agent.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 2
launchctl print "gui/$(id -u)/$LABEL" | grep -E "state =|pid =" || true
echo "Service installé. Journal : $DIR/agent.log"
