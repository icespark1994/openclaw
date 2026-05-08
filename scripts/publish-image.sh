#!/usr/bin/env bash
# Standard publish script for ainetrix/bot-core Docker image.
# See docs/reference/DOCKER-PUBLISH.md for full publish/rollback rules.
#
# Usage: bash scripts/publish-image.sh
set -euo pipefail

REGISTRY="ghcr.io/icespark1994/openclaw"

# Guard: working tree must be clean.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: uncommitted changes detected. Commit and push first." >&2
  exit 1
fi

BRANCH=$(git branch --show-current)
SHA8=$(git rev-parse --short=8 HEAD)

# Guard: HEAD must be pushed to remote.
if ! git ls-remote --exit-code origin "refs/heads/$BRANCH" >/dev/null 2>&1; then
  echo "ERROR: branch '$BRANCH' not found on remote. Push first." >&2
  exit 1
fi

REMOTE_SHA=$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1 | cut -c1-8)
if [ "$SHA8" != "$REMOTE_SHA" ]; then
  echo "ERROR: local HEAD ($SHA8) differs from remote ($REMOTE_SHA). Push first." >&2
  exit 1
fi

TAG="${REGISTRY}:git-${SHA8}"
echo "Building and pushing: $TAG"

pnpm build
pnpm ui:build

docker buildx build \
  --platform linux/amd64 \
  --build-arg OPENCLAW_EXTENSIONS="feishu" \
  -t "$TAG" \
  . \
  --push

echo "Done: $TAG"
