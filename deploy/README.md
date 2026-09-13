# Deploying Bricks by Bid to EC2

Everything in this folder is config/scripts for one architecture: a single
Ubuntu 22.04 EC2 instance running Postgres, the Next.js frontend, and the
WebSocket relay backend, all behind one nginx reverse proxy terminating
TLS for `bricksbybid.dreammerchantsevent.me`. This matches the app's
actual scale (~20-30 teams, one process expected per piece - see
`use-event-socket.ts`'s and `login-limiter.ts`'s in-memory, single-process
design) rather than over-building for a scale this was never meant to run
at.

I (the assistant) don't have AWS credentials or SSH access to anything -
every step below is something you run yourself. Paste me any error output
and I'll help you fix it from there.

## 1. Launch the instance

AWS Console → EC2 → Launch instance:
- **AMI**: Ubuntu Server 22.04 LTS
- **Instance type**: `t3.small` (2 vCPU, 2 GiB RAM) is comfortably enough
  for this app's actual load; go `t3.medium` if you want headroom to spare.
- **Storage**: 20 GiB gp3 is plenty.
- **Key pair**: create or reuse one you have the private key for (you'll
  SSH in with it).
- **Security group** — only open what's actually needed from the
  internet:
  | Port | Source | Why |
  |---|---|---|
  | 22 | your IP only (not 0.0.0.0/0) | SSH |
  | 80 | 0.0.0.0/0 | HTTP (redirects to HTTPS once certbot runs) |
  | 443 | 0.0.0.0/0 | HTTPS |

  Do **not** open 3000, 8080, or 5432 to the internet — nginx is the only
  public entry point; Next.js, the relay, and Postgres all stay bound to
  `localhost`.
- **Elastic IP**: allocate one and associate it with the instance, so the
  IP survives a stop/start. You'll point DNS at this.

## 2. DNS

At whatever registrar/DNS host manages `dreammerchantsevent.me`, add an
A record:

```
bricksbybid.dreammerchantsevent.me  →  <the Elastic IP>
```

Give it a few minutes to propagate before step 6 (certbot needs it
resolving correctly to issue a certificate).

## 3. SSH in and clone the repo

```bash
ssh -i your-key.pem ubuntu@<elastic-ip>
sudo mkdir -p /opt/bricksbybid
sudo chown ubuntu:ubuntu /opt/bricksbybid
git clone https://github.com/harshitchhabi/test_BBB.git /opt/bricksbybid
cd /opt/bricksbybid
```

## 4. Provision the server

```bash
sudo ./deploy/scripts/provision.sh
```

Installs Node 20, Postgres, nginx, certbot, creates the `bbb` system
user, and locks down the firewall to just 22/80/443. Doesn't touch
secrets, DNS, or TLS — those are next.

## 5. Database setup

```bash
sudo -u postgres psql
```
```sql
CREATE ROLE bbb_app WITH LOGIN PASSWORD 'pick-a-real-password-here';
CREATE DATABASE bricks_by_bid_prod OWNER bbb_app;
\q
```

Set up a `.pgpass` for the `bbb` user so the nightly backup script (step
9) doesn't need an interactive password:
```bash
sudo -u bbb bash -c 'echo "localhost:5432:bricks_by_bid_prod:bbb_app:pick-a-real-password-here" > ~/.pgpass && chmod 600 ~/.pgpass'
```

## 6. Secrets

```bash
sudo mkdir -p /etc/bricksbybid && sudo chmod 700 /etc/bricksbybid
sudo cp deploy/env/frontend.env.example /etc/bricksbybid/frontend.env
sudo cp deploy/env/backend.env.example /etc/bricksbybid/backend.env
sudo chown bbb:bbb /etc/bricksbybid/*.env
sudo chmod 600 /etc/bricksbybid/*.env
```

Generate the two secrets:
```bash
openssl rand -hex 32   # -> SESSION_SECRET (frontend.env only)
openssl rand -hex 32   # -> INTERNAL_BROADCAST_SECRET (BOTH files, byte-for-byte identical)
```

Edit both files (`sudo -u bbb nano /etc/bricksbybid/frontend.env` and
`.../backend.env`) and fill in: the two secrets above, the real
`bbb_app` password from step 5 in `DATABASE_URL` (URL-encode any special
characters, e.g. `@` → `%40`). `NEXT_PUBLIC_WS_URL` and
`TRUST_PROXY_HEADERS` are already correct for this exact setup - leave
them as the example has them.

## 7. nginx (HTTP first, TLS comes next step)

```bash
sudo cp deploy/nginx/bricksbybid.conf /etc/nginx/sites-available/bricksbybid
sudo ln -s /etc/nginx/sites-available/bricksbybid /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 8. First deploy

```bash
sudo chown -R bbb:bbb /opt/bricksbybid
sudo -u bbb ./deploy/scripts/deploy.sh
```

This runs migrations, builds the frontend, and starts both services - but
they aren't enabled to survive a reboot yet:
```bash
sudo cp deploy/systemd/bbb-frontend.service deploy/systemd/bbb-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bbb-frontend bbb-backend
```

Verify:
```bash
curl http://localhost:3000            # should return the login page HTML
curl http://localhost:8080/health      # {"ok":true,"rooms":0,...}
```

## 9. TLS

```bash
sudo certbot --nginx -d bricksbybid.dreammerchantsevent.me
```

Follow its prompts (email for renewal notices, agree to terms, and let
it redirect HTTP → HTTPS when asked). Certbot rewrites
`/etc/nginx/sites-available/bricksbybid` in place to add the TLS
`listen 443` block and sets up its own auto-renewal timer - nothing
further to do. Visit `https://bricksbybid.dreammerchantsevent.me` and
confirm the padlock and the login page both work.

## 10. Create the first event

There's no in-app "create event" flow yet - it only happens via the seed
script (see `packages/db/seed/run.ts`), so this always needs SSH access,
today and for every future event:

```bash
cd /opt/bricksbybid/packages/db
set -a; source /etc/bricksbybid/backend.env; set +a
npx tsx seed/run.ts "Your Event Name" your-admin-username
```

It prints the admin's username/password once - write it down immediately,
it's never shown again (only re-issuable via a password reset from
another staff login, or by re-running `resetLoginPassword` directly).

## 11. Backups

```bash
sudo -u bbb crontab -e
```
Add:
```
0 3 * * * /opt/bricksbybid/deploy/scripts/backup-db.sh
```

## 12. Monitoring (optional but recommended)

Point any free uptime monitor (UptimeRobot, healthchecks.io, etc.) at:
- `https://bricksbybid.dreammerchantsevent.me/` — is the site up at all
- `https://bricksbybid.dreammerchantsevent.me/relay-health` — is the
  timer sweep actually still running (returns 503 once it's gone stale;
  see `backend/src/index.ts`'s `/health`). Remove this nginx location if
  you'd rather not expose it and only check it over SSH.

## Updating later

```bash
cd /opt/bricksbybid
sudo -u bbb ./deploy/scripts/deploy.sh
```

## Rollback

```bash
cd /opt/bricksbybid
git log --oneline -5           # find the commit to go back to
sudo -u bbb git checkout <commit-sha>
sudo -u bbb npm ci
set -a; source /etc/bricksbybid/frontend.env; set +a
sudo -u bbb bash -c 'cd frontend && npm run build'
sudo systemctl restart bbb-backend bbb-frontend
```
Migrations are additive (see `packages/db/migrations/`) - there's no
automated "undo a migration" step; if a bad deploy included a migration
you need to roll back, that has to be handled by hand against that
specific migration file, not by this generic rollback.
