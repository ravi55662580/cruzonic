#!/usr/bin/env bash
set -euo pipefail

echo "=== Cruzonic — Developer Setup ==="

# ── 1. Check required tools ─────────────────────────────────────────────────
check_tool() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: '$1' is not installed. $2"
    exit 1
  fi
}

check_tool node    "Install from https://nodejs.org (>=18)"
check_tool npm     "Comes with Node.js"
check_tool supabase "Install: npm install -g supabase"

echo "✓ All required tools found"

# ── 2. Install dependencies ──────────────────────────────────────────────────
echo ""
echo "Installing npm workspaces dependencies..."
npm install
echo "✓ Dependencies installed"

# ── 3. Copy .env.example files ───────────────────────────────────────────────
echo ""
echo "Copying environment templates..."

for service in backend portal mobile; do
  if [ ! -f "$service/.env" ]; then
    cp "$service/.env.example" "$service/.env"
    echo "  Created $service/.env (edit this file with your Supabase credentials)"
  else
    echo "  $service/.env already exists — skipping"
  fi
done

# ── 4. Start local Supabase ──────────────────────────────────────────────────
echo ""
echo "Starting local Supabase stack (requires Docker)..."
npx supabase start

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Update backend/.env, portal/.env, and mobile/.env with your Supabase credentials"
echo "  2. Run 'npx ts-node scripts/seed.ts' to seed the local database"
echo "  3. Run 'npm run dev:backend' and 'npm run dev:portal' from the root"
