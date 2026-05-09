# Deployment to Hetzner VPS

## Prereqs
1. A Hetzner CX11 (or larger) running Debian/Ubuntu.
2. A subdomain pointed at the VPS IPv4 (A record).
3. SSH access as root or a sudoer.

## One-time setup

```bash
ssh root@your-vps
apt-get update && apt-get install -y docker.io docker-compose-plugin git
git clone <this-repo> wedding-quiz && cd wedding-quiz
cp .env.example .env
# Edit .env -> set PUBLIC_URL=https://quiz.your-domain.com
echo 'PUBLIC_HOST=quiz.your-domain.com' >> .env
```

## Boot

```bash
docker compose --env-file .env up -d --build
```

Caddy will auto-provision a Let's Encrypt cert on the first HTTPS request.

## Backup before the wedding

```bash
tar czf wq-backup-$(date +%Y%m%d).tar.gz data/
scp root@your-vps:wq-backup-*.tar.gz ./
```

## Recovery

- Lost creator URL? Open `/create` again — old quiz is unrecoverable. Bookmark the new one.
- Server reboot mid-game? Game state is in SQLite; the host can re-open `/host/<token>` and the active game resumes.
- A guest was kicked accidentally? The kicked row in `players` is sticky. To re-allow, ask them to use a different name (their stored `player_token` will fall through to a fresh join).

## Tuning

- Default rate limits suit ~150 concurrent players. To go higher, increase `socketCxnLru` `max` and per-socket `emit-bucket` rate in `src/lib/rate-limit.js`.
