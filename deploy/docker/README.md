# Docker Compose deployment (alternative to deploy/README.md)

Same target architecture as the native EC2 setup — one host, nginx
terminating TLS and reverse-proxying to the frontend and the relay,
Postgres persisting data — just running the app itself in containers
instead of via systemd + a bare `npm ci` on the host. Steps 1–2 (launch
the instance, DNS) and step 9 (TLS/certbot) from `deploy/README.md` are
identical here; this file replaces steps 4–8 (provisioning, database
setup, secrets, nginx, first deploy) with the Docker equivalents.

## 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out and back in for the group change to take effect
```

## 2. Install nginx + certbot on the host (still needed — see why below)

```bash
sudo apt-get update && sudo apt-get install -y nginx certbot python3-certbot-nginx
```

Postgres/frontend/backend all run in containers, but nginx stays on the
host: it's the one thing that needs to bind port 80/443 directly and
hold the TLS certificate, and `deploy/nginx/bricksbybid.conf` already
proxies to `127.0.0.1:3000`/`127.0.0.1:8080` — exactly where
docker-compose.yml publishes the frontend/backend containers' ports, so
the same nginx config file works unchanged.

```bash
sudo cp deploy/nginx/bricksbybid.conf /etc/nginx/sites-available/bricksbybid
sudo ln -s /etc/nginx/sites-available/bricksbybid /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d bricksbybid.dreammerchantsevent.me
```

## 3. Secrets

```bash
cp deploy/docker/.env.example deploy/docker/.env
cp deploy/docker/frontend.env.example deploy/docker/frontend.env
cp deploy/docker/backend.env.example deploy/docker/backend.env
chmod 600 deploy/docker/.env deploy/docker/frontend.env deploy/docker/backend.env
```

Generate the two secrets and fill in all three files (same values
explained in each file's own comments — `POSTGRES_PASSWORD` in `.env`
must match the password embedded in both `DATABASE_URL`s):
```bash
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # INTERNAL_BROADCAST_SECRET (both frontend.env and backend.env)
```

These three files are already covered by the repo's `.dockerignore` and
should never be committed.

## 4. Build and start

```bash
cd /opt/bricksbybid   # wherever you cloned the repo
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env up -d --build
```

## 5. Run migrations

```bash
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env \
  exec backend sh -c "cd /app/packages/db && npx tsx src/migrate.ts"
```

## 6. Create the first event

Same caveat as the native deployment — there's no in-app "create event"
flow, only the seed script:

```bash
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env \
  exec backend sh -c "cd /app/packages/db && npx tsx seed/run.ts 'Your Event Name' your-admin-username"
```

## 7. Verify

```bash
curl http://localhost:3000
curl http://localhost:8080/health
```

Then visit `https://bricksbybid.dreammerchantsevent.me`.

## Updating later

```bash
git pull origin main
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env up -d --build
```
(New migrations still need the same `exec backend ... migrate.ts` step
from step 5 after this.)

## Backups

Same idea as `deploy/scripts/backup-db.sh`, adjusted for the container:
```bash
docker compose -f deploy/docker/docker-compose.yml --env-file deploy/docker/.env \
  exec postgres pg_dump -U bbb_app bricks_by_bid_prod | gzip > backup-$(date +%Y%m%d).sql.gz
```
Put this on a host cron job the same way `deploy/README.md` does.

## Logs / troubleshooting

```bash
docker compose -f deploy/docker/docker-compose.yml logs -f frontend
docker compose -f deploy/docker/docker-compose.yml logs -f backend
```
