#!/usr/bin/env bash
# Ejecutar en la VPS (root) una sola vez: librerías para el Chrome que usa whatsapp-web.js / Puppeteer.
# Ubuntu/Debian. Tras instalar, opcional: exportar en .env
#   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# (comprobar con: command -v chromium)

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq

apt-get install -y -qq \
  chromium \
  ca-certificates \
  fonts-liberation \
  libasound2t64 \
  libatk-bridge2.0-0t64 \
  libatk1.0-0t64 \
  libcups2t64 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0t64 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libxss1 \
  poppler-utils \
  || apt-get install -y -qq \
    chromium \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxss1 \
    poppler-utils

echo "Listo. Chromium en: $(command -v chromium || command -v chromium-browser || true)"
