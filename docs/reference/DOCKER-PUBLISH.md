# Docker Image Publish & Rollback

Registry: `ghcr.io/icespark1994/openclaw`

## Fixed Rules

| Rule       | Value                                      |
| ---------- | ------------------------------------------ |
| SHA length | 8 digits (`git rev-parse --short=8 HEAD`)  |
| Tag format | `git-<sha8>`                               |
| Full tag   | `ghcr.io/icespark1994/openclaw:git-<sha8>` |
| Platform   | `linux/amd64`                              |

## Publish

Prerequisites: working tree clean, HEAD pushed to remote.

```bash
bash scripts/publish-image.sh
```

The script runs these steps in order:

1. Verify working tree is clean (`git diff --quiet`)
2. Verify local HEAD matches remote HEAD (push guard)
3. `pnpm build`
4. `pnpm ui:build`
5. `docker buildx build --platform linux/amd64 -t ghcr.io/icespark1994/openclaw:git-<sha8> . --push`

## Rollback

To roll back to a previous image on VPS:

1. Edit `docker-compose.yml` on VPS — change `image:` to the previous `git-<sha8>` tag
2. Run `docker compose up -d`
3. Verify container is healthy: `docker ps` → STATUS should show `healthy`
4. Telegram smoke test: send a message and confirm the bot responds
