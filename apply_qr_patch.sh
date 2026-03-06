#!/bin/bash
set -e
FILE="/workspaces/pkr-reloaded/frontend/src/app/events/[id]/page.tsx"
echo "Patching: $FILE"

# 1. Add React import if not already present
if ! grep -q "^import React from 'react'" "$FILE"; then
  sed -i "s/^'use client';/'use client';\nimport React from 'react';/" "$FILE"
  echo "  + Added React import"
else
  echo "  - React import already present"
fi

# 2+3. Python does the rest
python3 /tmp/qr_patch.py

echo ""
echo "Patch complete. Now run:"
echo "  cd /workspaces/pkr-reloaded"
echo "  git add frontend/src/app/events/\\[id\\]/page.tsx"
echo "  git commit -m 'Add self-contained QR code to invite modal'"
echo "  git push"
