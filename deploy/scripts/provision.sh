#!/usr/bin/env bash
# One-time server setup. Run as root (or with sudo) on a fresh Ubuntu
# 22.04 LTS EC2 instance, AFTER you've cloned the repo to /opt/bricksbybid
# (see deploy/README.md step 3 for the clone step - this script assumes
# it already exists there). Installs Node, Postgres, nginx, certbot,
# creates the app user, and enables the firewall. Does NOT start the app
# services or touch env files/secrets/DNS/TLS - deploy/README.md walks
# through those by hand right after this, since they need values only
# you have (passwords, the domain, etc).
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "Run as root (sudo ./deploy/scripts/provision.sh)"; exit 1
fi

echo "==> apt update/upgrade"
apt-get update -y
apt-get upgrade -y

echo "==> Installing Node.js 20 LTS"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "==> Installing Postgres"
apt-get install -y postgresql postgresql-contrib

echo "==> Installing nginx and certbot"
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Creating the bbb service user (no login shell, no home dir needed beyond the app)"
if ! id bbb &>/dev/null; then
  useradd --system --create-home --home-dir /home/bbb --shell /usr/sbin/nologin bbb
fi
chown -R bbb:bbb /opt/bricksbybid

echo "==> Firewall (ufw): allow SSH, HTTP, HTTPS only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Done. Next: deploy/README.md's 'Database setup', 'Secrets', 'First deploy', and 'TLS' steps."
