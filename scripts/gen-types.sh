#!/usr/bin/env bash
set -euo pipefail

# Requires SUPABASE_PROJECT_ID to be set
if [ -z "${SUPABASE_PROJECT_ID:-}" ]; then
  echo "ERROR: SUPABASE_PROJECT_ID environment variable is not set."
  echo "Export it before running this script:"
  echo "  export SUPABASE_PROJECT_ID=<your-project-ref>"
  exit 1
fi

OUTPUT="shared/src/types/supabase.generated.ts"

echo "Generating Supabase TypeScript types..."
npx supabase gen types typescript \
  --project-id "$SUPABASE_PROJECT_ID" \
  --schema public \
  > "$OUTPUT"

echo "✓ Types written to $OUTPUT"
echo "  Remember to rebuild the shared package: cd shared && npm run build"
