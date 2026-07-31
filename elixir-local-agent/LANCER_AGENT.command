#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo "  Elixir Pharma — Agent local PharmaML"
echo "  ====================================="
echo ""

# Vérifie que Node est installé
if ! command -v node >/dev/null 2>&1; then
  echo "  ✗ Node.js n'est pas installé. Installez-le depuis https://nodejs.org"
  echo ""
  read -n 1 -s -r -p "  Appuyez sur une touche pour fermer..."
  exit 1
fi

# Crée le .env au premier lancement s'il manque (à partir du modèle)
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "  ⚠ Fichier .env créé depuis .env.example — pensez à y mettre le mot de passe PharmaML."
  echo ""
fi

# Libère le port 3001 si un ancien agent tourne encore
PIDS=$(lsof -ti:3001 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "  ⟳ Ancien agent détecté sur le port 3001 — arrêt..."
  kill $PIDS 2>/dev/null
  sleep 1
fi

node agent.js
