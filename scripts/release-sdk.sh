#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# AACP SDK — Generate & Publish
#
# Usage:
#   ./scripts/release-sdk.sh              → publish @latest
#   ./scripts/release-sdk.sh beta         → publish @beta
#   ./scripts/release-sdk.sh patch        → bump patch + publish
#   ./scripts/release-sdk.sh minor        → bump minor + publish
#   ./scripts/release-sdk.sh major        → bump major + publish
#
# Prerequisites:
#   - API running on localhost:3009 (cd apps/api && pnpm dev)
#   - npm login done (npm whoami)
#   - pnpm installed
# ═══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SDK_DIR="$ROOT_DIR/packages/sdk"
API_PORT="${AACP_API_PORT:-3009}"
API_URL="http://localhost:$API_PORT/openapi.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[SDK]${NC} $1"; }
warn() { echo -e "${YELLOW}[SDK]${NC} $1"; }
err()  { echo -e "${RED}[SDK]${NC} $1" >&2; exit 1; }

# ─── Preflight ────────────────────────────────────────────────
log "Checking prerequisites..."

# Check npm auth
npm whoami >/dev/null 2>&1 || err "Not logged in to npm. Run: npm login"

# Check API running
if ! curl -sf "$API_URL" >/dev/null 2>&1; then
  err "API not running on port $API_PORT. Start with: cd apps/api && pnpm dev"
fi

log "API responding at $API_URL ✓"

# ─── Version bump (optional) ─────────────────────────────────
cd "$SDK_DIR"

TAG="latest"
if [ "${1:-}" = "beta" ]; then
  TAG="beta"
  log "Publishing with tag: beta"
elif [ "${1:-}" = "patch" ] || [ "${1:-}" = "minor" ] || [ "${1:-}" = "major" ]; then
  npm version "$1" --no-git-tag-version
  log "Bumped version to $(node -p 'require("./package.json").version')"
fi

VERSION=$(node -p 'require("./package.json").version')
log "Version: $VERSION (tag: $TAG)"

# ─── Clean ────────────────────────────────────────────────────
log "Cleaning previous build..."
rm -rf dist src/generated

# ─── Generate from OpenAPI ────────────────────────────────────
log "Generating SDK from OpenAPI spec..."
pnpm generate

GENERATED_FILES=$(find src/generated -name "*.ts" 2>/dev/null | wc -l)
log "Generated $GENERATED_FILES files from spec"

if [ "$GENERATED_FILES" -lt 5 ]; then
  err "Too few generated files ($GENERATED_FILES). Check OpenAPI spec."
fi

# ─── Build ────────────────────────────────────────────────────
log "Compiling TypeScript..."
pnpm build

DIST_FILES=$(find dist -name "*.js" 2>/dev/null | wc -l)
log "Compiled $DIST_FILES JS files"

# ─── Publish ──────────────────────────────────────────────────
log "Publishing @zyon/sdk@$VERSION to npm (tag: $TAG)..."
npm publish --access public --tag "$TAG"

log "═══════════════════════════════════════════"
log "✅ @zyon/sdk@$VERSION published!"
log ""
log "Install:"
log "  npm install @zyon/sdk"
log ""
log "Usage:"
log "  import { createClient } from '@zyon/sdk';"
log "  const aacp = createClient({ apiKey: 'aacp_live_...' });"
log "═══════════════════════════════════════════"
