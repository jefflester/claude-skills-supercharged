#!/usr/bin/env bash
set -e

cd "${CLAUDE_PROJECT_DIR}/.claude/hooks"

# Load API key from .env if available
if [ -f .env ]; then
    set -a  # automatically export variables
    # shellcheck disable=SC1091
    source .env
    set +a
fi

cat | npx tsx skill-activation-prompt.ts || true
