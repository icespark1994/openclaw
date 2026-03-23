#!/usr/bin/env bash
# Stage 9C publish: commit must be pushed before running this script.
# Usage: bash scripts/publish-image.sh
set -euo pipefail

REGISTRY="ghcr.io/icespark1994/openclaw"
PREFIX="stage9c1"

# Guard: working tree must be clean and HEAD must exist on remote.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: uncommitted changes detected. Commit and push first." >&2
  exit 1
fi

BRANCH=$(git branch --show-current)
SHORTSHA=$(git rev-parse --short HEAD)

if ! git ls-remote --exit-code origin "refs/heads/$BRANCH" >/dev/null 2>&1; then
  echo "ERROR: branch '$BRANCH' not found on remote. Push first." >&2
  exit 1
fi

REMOTE_SHA=$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1 | cut -c1-9)
if [ "${SHORTSHA}" != "${REMOTE_SHA:0:${#SHORTSHA}}" ]; then
  echo "ERROR: local HEAD ($SHORTSHA) differs from remote ($REMOTE_SHA). Push first." >&2
  exit 1
fi

TAG="${REGISTRY}:${PREFIX}-${SHORTSHA}"
echo "Building and pushing: $TAG"

pnpm build
pnpm ui:build

docker buildx build \
  --platform linux/amd64 \
  -t "$TAG" \
  . \
  --push

echo "Done: $TAG"
