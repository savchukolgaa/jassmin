# Deploying the shop to a Hetzner server

The shop runs in production on **one Hetzner Cloud server** with Docker Compose (#176). One command
on your computer, `pnpm aspire:deploy`, builds the images, pushes them to the GitHub Container
Registry (GHCR) and starts them on the server over SSH. The server runs everything:

| Service | What it is |
|---------|------------|
| `proxy` | Caddy: HTTPS with automatic Let's Encrypt certificates for the shop, the admin domain and `stats.<shop-domain>` (the owner's dashboard, behind a password). The only service reachable from the internet (ports 80 and 443). |
| `web` | The shop (React Router, `react-router-serve`). |
| `cms` | Strapi, the admin for products, orders and content, on the admin domain. Uploads are on the `jassmin-strapi-uploads` volume. |
| `postgres` | PostgreSQL 18 with `jassmindb` (the shop) and `strapidb` (Strapi), on the `jassmin-postgres-data` volume. Not reachable from the internet. |
| `db-migrate` | Runs once per deploy: creates the two databases if they're missing, then applies the migrations. `web`, `cms` and `scheduler` start after it. |
| `scheduler` | The scheduled jobs from `deploy/crontab` (supercronic): CMS sync and order emails every 5 minutes, abandoned carts, cart reminders and unpaid orders hourly, gift cards and rate limits nightly. |
| `pg-backup` | A `pg_dump` of both databases every night at 02:00 UTC into `/srv/jassmin/backups`, kept 7 days. |
| `analytics-setup` | Runs once per deploy, after `db-migrate`: creates the `jassmin_wh` database and the warehouse's read-only roles (#183). |
| `analytics` | The owner's dashboard, every night at 01:00 UTC: a pseudonymised copy of the shop's data into `jassmin_wh`, the dbt marts, and the Evidence site on the `jassmin-stats-site` volume ([The owner's dashboard](#the-owners-dashboard)). |

Browsers never talk to Strapi for images: the shop serves Strapi's uploads at `/uploads/…` from its
own domain and fetches them from `cms` inside the server (`app/.server/cms/uploads-proxy.ts`).

The deployment is declared in `aspire-apphost/production.mts`; `pnpm aspire run` (development) is
unaffected. Card payments (LiqPay, #192) stay off until you turn them on after LiqPay approves the
shop ([payments.md → Going live](payments.md#going-live)), and the AI perfumer stays off (#167).

## Contents

1. [What it costs](#what-it-costs)
2. [What you need](#what-you-need)
3. [Create the server](#1-create-the-server)
4. [Prepare the server](#2-prepare-the-server)
5. [DNS records](#3-dns-records)
6. [GitHub Container Registry](#4-github-container-registry)
7. [The first deploy](#5-the-first-deploy)
8. [Strapi: the first admin and the API tokens](#6-strapi-the-first-admin-and-the-api-tokens)
9. [Fill the shop](#7-fill-the-shop)
10. [Check that it works](#8-check-that-it-works)
11. [Updating](#updating)
12. [Changing a setting or a secret](#changing-a-setting-or-a-secret)
13. [Logs and one-off commands](#logs-and-one-off-commands)
14. [Backups and restoring](#backups-and-restoring)
15. [The owner's dashboard](#the-owners-dashboard)
16. [Troubleshooting](#troubleshooting)

## What it costs

| Item | Per month (before VAT) |
|------|------------------------|
| Hetzner Cloud **CX23** (2 vCPU, 4 GB RAM, 40 GB disk, 20 TB traffic, one IPv4 address) | €5.99 |
| Hetzner **backups** (7 daily server snapshots, +20% of the server price) | ≈ €1.20 |
| GHCR (private images of a personal repo, within the free storage) | €0 |
| Let's Encrypt certificates | €0 |
| **Total** | **≈ €7.19** |

The domain and Brevo (email, [docs/email.md](email.md)) are billed separately.

## What you need

- A Hetzner Cloud account (https://console.hetzner.cloud).
- The shop's domain and access to its DNS records. This guide writes `<shop-domain>` for it (e.g.
  `example.ua`) and `admin.<shop-domain>` for the Strapi admin.
- On your computer: this repo, Docker Desktop (running), Node and pnpm as in the
  [README](../README.md), the Aspire CLI, and OpenSSH (`ssh`, `scp`; included in Windows 10/11, macOS
  and Linux).
- A GitHub account with access to this repo.
- Brevo set up as in [docs/email.md](email.md) for `SMTP_URL` and the webhook secret. You can deploy
  before that and change the two values later ([Changing a setting](#changing-a-setting-or-a-secret)).

## 1. Create the server

1. Make an SSH key if you don't have one: `ssh-keygen -t ed25519 -C "jassmin deploy"` (press Enter
   for the default file; set a passphrase). The public key is `~/.ssh/id_ed25519.pub`.
2. In the Hetzner console, create a project, then **Add Server**:
   - **Location:** Nuremberg, Falkenstein or Helsinki (the EU locations closest to Ukraine).
   - **Image:** Ubuntu 24.04.
   - **Type:** Shared vCPU → x86 (Intel/AMD) → **CX23**.
   - **Networking:** public IPv4 and IPv6.
   - **SSH keys:** add your public key (paste the contents of `id_ed25519.pub`).
   - **Backups:** turn on.
   - **Firewalls:** create one with inbound rules only for **TCP 22**, **TCP 80** and **TCP 443**,
     from any IPv4 and IPv6. Everything else, Postgres included, is blocked.
   - **Name:** e.g. `jassmin-prod`.
3. Note the server's IPv4 and IPv6 addresses.

## 2. Prepare the server

Log in as root once: `ssh root@<server-ip>`. Then:

```bash
# Updates, and security updates from now on.
apt-get update && apt-get -y upgrade
apt-get -y install unattended-upgrades

# Docker Engine and the Compose plugin, from Docker's own repository.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Rotate container logs so they can't fill the disk.
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
EOF
systemctl restart docker

# The deploy user: may run Docker, logs in with your key only.
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh && cp /root/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh

# Where the Compose files and the database dumps live.
mkdir -p /srv/jassmin/backups && chown -R deploy:deploy /srv/jassmin

# 4 GB of swap for the owner's dashboard's nightly build (#183), used only under memory pressure.
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf && sysctl --system

# SSH: keys only, no root login.
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh
```

Before you close the root session, check from your computer in a **second** terminal that
`ssh deploy@<server-ip>` works. From now on you only log in as `deploy`.

Why swap: the dashboard's nightly build (Evidence) needs about 3 GB for a few minutes, which the
4 GB server can't spare next to Postgres, Strapi and the shop. `deploy/docker-compose.override.yaml`
caps the `analytics` service at 2 GB of RAM, lets it use swap for the rest, and makes it the
kernel's first choice if memory still runs out, so Postgres and the shop are never the ones killed.
On a server that already runs without it, add the swap the same way (as root, or with `sudo`).
`free -h` shows it.

Docker's own port publishing bypasses `ufw`, so the Hetzner firewall from step 1 is what keeps the
server closed; only `proxy` publishes ports anyway.

## 3. DNS records

At your DNS host, add (TTL 1 hour is fine):

| Name | Type | Value |
|------|------|-------|
| `<shop-domain>` | A | the server's IPv4 |
| `<shop-domain>` | AAAA | the server's IPv6 |
| `www.<shop-domain>` | A / AAAA | the same (it redirects to `<shop-domain>`) |
| `admin.<shop-domain>` | A / AAAA | the same |
| `stats.<shop-domain>` | A / AAAA | the same (the owner's dashboard, #183) |

Keep the email records from [docs/email.md](email.md) as they are. Wait until
`nslookup <shop-domain>` shows the server's address: Caddy can only get a certificate once the
domain points at the server.

## 4. GitHub Container Registry

The images are **private** packages on GHCR, so both sides need a token.

1. On GitHub: Settings → Developer settings → Personal access tokens → **Tokens (classic)** →
   Generate new token.
   - For your computer: scope **`write:packages`** (it includes reading). Name it
     `jassmin push`.
   - For the server: a second token with only **`read:packages`**, named `jassmin server pull`.
2. On your computer: `docker login ghcr.io -u <github-user>` and paste the push token as the password.
3. On the server, as `deploy`: `docker login ghcr.io -u <github-user>` with the pull token.

After the first deploy, the packages appear under your GitHub profile → Packages, private by
default. Leave them private.

## 5. The first deploy

On your computer, in the repo's main checkout, with Docker Desktop running:

```powershell
# PowerShell
$env:DEPLOY_SSH_TARGET = "deploy@<server-ip>"
pnpm aspire:deploy
```

```bash
# bash / zsh
DEPLOY_SSH_TARGET=deploy@<server-ip> pnpm aspire:deploy
```

`pnpm aspire:deploy` runs `aspire do deploy-ssh -o aspire-output`. Don't use `aspire deploy`: it
would also start the whole stack on your own computer.

The first time, Aspire asks for these values:

| Parameter | What to enter |
|-----------|---------------|
| `site-domain` | `<shop-domain>`, without `https://` |
| `admin-domain` | `admin.<shop-domain>` |
| `ghcr-repository` | `<github-user>/jassmin` (lowercase) |
| `smtp-url` | The Brevo SMTP URL from [docs/email.md](email.md) → Configure the app |
| `email-webhook-secret` | 32+ random characters, the same as in Brevo's webhook ([docs/email.md](email.md)) |
| `strapi-api-token` | `pending` for now (see step 6) |
| `strapi-sync-token` | `pending` for now |
| `liqpay-public-key` | `pending` until LiqPay approves the shop ([payments.md](payments.md#going-live)) |
| `liqpay-private-key` | `pending` too |
| `stats-password` | A password for the owner's dashboard on `stats.<shop-domain>` (user `owner`); keep it in your password manager |

Every one of them is required: since Aspire 17.0 an empty answer is rejected, which is why the
tokens get `pending` until Strapi exists, and the LiqPay keys until LiqPay approves the shop.
`payment-provider` isn't asked for: it defaults to `none`, so card payment is off until you set it
to `liqpay` ([payments.md → Going live](payments.md#going-live)).

Aspire **generates** the other secrets on the first deploy: the Postgres password,
`SESSION_SECRET`, `CMS_SYNC_SECRET`, `EMAIL_UNSUBSCRIBE_SECRET` and Strapi's `APP_KEYS`,
`API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET` and `ENCRYPTION_KEY`,
and the warehouse's `wh-extract-password`, `wh-owner-password`, `wh-reader-password` and
`wh-pseudonym-key` (#183). `registry-endpoint` is `ghcr.io` by default.

The deploy then builds the images (a few minutes the first time), pushes them, copies
`docker-compose.yaml` (with `deploy/docker-compose.override.yaml`) and the `.env` with the values to `/srv/jassmin` (the `.env` readable only by
`deploy`), and runs `docker compose pull` and `docker compose up -d` on the server.

### Back up the deployment state

Aspire keeps every value, the generated secrets included, in
`%USERPROFILE%\.aspire\deployments\<hash>\production.json` (`~/.aspire/deployments/<hash>/` on
macOS/Linux; the newest folder there). Aspire 17.0 also writes a `production.json.migration`
file next to it; back up the whole folder. **Copy it into your password manager now.** If it's lost,
the next deploy generates new secrets: everyone is logged out of the shop, unsubscribe links in
emails already sent stop working, and Strapi can't read its encrypted data until the old
`ENCRYPTION_KEY` is restored. The same values are also in `/srv/jassmin/.env` on the server, so you
can rebuild the file from there.

## 6. Strapi: the first admin and the API tokens

The shop starts without Strapi tokens: shop pages that come from Strapi (home, blog, offers) show
an error until the tokens are set, and the sync jobs keep their changes queued.

1. Open `https://admin.<shop-domain>/admin` and register the first Strapi admin. Do this right away:
   until someone registers, anyone who opens the page could.
2. Settings → API Tokens → Create new API Token, type **Custom**, duration **Unlimited**, with only:
   - Blog-post: `find`, `findOne`
   - Home-page: `find`
   - Offer: `find`
   - Site-setting: `find`

   Save it and copy the token: this is `strapi-api-token`.
3. A second **Custom**, **Unlimited** token with only `find`, `findOne`, `create` and `update` on
   Product, Order and Gift-card: this is `strapi-sync-token`.
4. Put both into the deployment state ([Changing a setting](#changing-a-setting-or-a-secret)) and
   run `pnpm aspire:deploy` again.

Don't run the Strapi seed (`pnpm cms:seed`) in production: it adds demo blog posts and offers.

## 7. Fill the shop

The databases start empty. Run these once, in this order, on the server (`ssh deploy@<server-ip>`,
then `cd /srv/jassmin`):

```bash
# Load the shop's perfume range (#66) and put it on the standard sizes and prices (#98).
docker compose exec scheduler pnpm db:import-catalog
docker compose exec scheduler pnpm db:apply-catalog-prices
# Copy the whole catalog into Strapi (#40). Needs strapi-sync-token from step 6.
docker compose exec scheduler pnpm db:sync-cms -- --all
```

Then create the home page, site settings and offers in the Strapi admin. After the first deploy, submit the sitemap to the search engines as in
[docs/setup.md → SEO](setup.md#seo).

## 8. Check that it works

- `https://<shop-domain>` shows the shop with a valid certificate; `http://` and `www.` redirect.
- `https://admin.<shop-domain>/admin` shows the Strapi login.
- From your computer, `Test-NetConnection <server-ip> -Port 5432` (PowerShell) or
  `nc -vz <server-ip> 5432` fails: Postgres isn't reachable.
- `docker compose ps` on the server shows every service `running` (and `db-migrate` exited 0).
- `docker compose logs scheduler` shows a job run within 5 minutes.
- The next morning, `ls -l /srv/jassmin/backups` shows two `.dump` files.
- `https://stats.<shop-domain>` asks for a password (user `owner`, the `stats-password`); before
  the first night it shows "Статистика ще не зібрана", from the next morning the dashboard with
  "Дані на …" at the top of every page. `docker compose logs analytics` shows the night's run.
- The security headers check in [docs/security.md](security.md) passes for `https://<shop-domain>`.
- Upload an image in Strapi, use it on a product, and check it shows on the shop at
  `https://<shop-domain>/uploads/…`. Then `sudo reboot` the server: after a minute everything is
  back, the image included.

## Updating

Merge to `main`, then from the main checkout:

```bash
DEPLOY_SSH_TARGET=deploy@<server-ip> pnpm aspire:deploy
```

It builds and pushes new images, `db-migrate` applies any new migrations, and only the services
whose image changed are restarted. The data, uploads and certificates are on volumes and survive.
The shop is unavailable for a few seconds while `web` restarts.

## Changing a setting or a secret

Edit the value in the deployment state file (`production.json`, see
[Back up the deployment state](#back-up-the-deployment-state)), e.g. `"Parameters:strapi-api-token"`,
save, and run `pnpm aspire:deploy`. Services whose environment changed are recreated. To be asked
for a value again, delete its line instead.

Don't change the generated secrets unless one has leaked: see above for what each one breaks.
The Postgres password is set when the data volume is first created, so changing
`postgres-password` later also needs `ALTER USER postgres PASSWORD '…'` inside the database
(`docker compose exec pg-backup psql -d postgres`, before the deploy).

## Logs and one-off commands

On the server, in `/srv/jassmin`:

```bash
docker compose ps                         # what's running
docker compose logs -f web                # the shop (also cms, scheduler, proxy, pg-backup, …)
docker compose logs --since 1h scheduler  # the last hour's jobs
docker compose exec scheduler pnpm db:sync-cms   # any `pnpm db:…` job, by hand
docker compose restart web                # restart one service
docker compose exec pg-backup psql -d jassmindb   # a SQL shell (pg-backup has the credentials)
```

## Backups and restoring

There are two layers:

- **Hetzner backups** (step 1): a snapshot of the whole server every day, 7 kept. They include the
  Strapi uploads and the certificates. Restore one in the Hetzner console → the server → Backups →
  Restore (this replaces the whole disk with that day's state).
- **Database dumps**: `pg-backup` writes `jassmindb-<time>.dump` and `strapidb-<time>.dump` to
  `/srv/jassmin/backups` every night at 02:00 UTC and deletes those older than 7 days. Make one by
  hand any time with `docker compose exec pg-backup backup.sh`. The warehouse, `jassmin_wh`, is
  deliberately not dumped: the next night rebuilds it from `jassmindb`.

For a copy off the server, download a dump now and then:
`scp deploy@<server-ip>:/srv/jassmin/backups/jassmindb-*.dump .`

### Restoring a database dump

This replaces a database with the dump. The commands run in the `pg-backup` container, which has
the database credentials and sees the dumps at `/backups` (the `postgres` container asks for a
password even inside). On the server, in `/srv/jassmin`:

```bash
ls -l backups/                                  # pick the dump, e.g. jassmindb-20261118T020000Z.dump
docker compose exec pg-backup backup.sh         # a fresh dump first, in case you need to go back
docker compose stop web scheduler cms           # nothing writes while restoring

# The shop's database:
docker compose exec pg-backup pg_restore --clean --if-exists --no-owner \
  -d jassmindb /backups/jassmindb-20261118T020000Z.dump
# Strapi's database, from the same night:
docker compose exec pg-backup pg_restore --clean --if-exists --no-owner \
  -d strapidb /backups/strapidb-20261118T020000Z.dump

docker compose start cms web scheduler
```

Restore both databases from the same night so orders and products in Strapi match the shop. To
look at a dump without touching the live data, restore it into a scratch database instead:

```bash
docker compose exec pg-backup createdb restore_test
docker compose exec pg-backup pg_restore --no-owner -d restore_test /backups/jassmindb-….dump
docker compose exec pg-backup psql -d restore_test -c "select count(*) from orders"
docker compose exec pg-backup dropdb restore_test
```

These steps were tested on a local copy of the deployment (#176): a dump, a restore into a scratch
database, and a full restore of both databases that undid a change made after the dump.

### Moving to a new server

Set up the new server (steps 1–4), point `DEPLOY_SSH_TARGET` at it and run `pnpm aspire:deploy`.
Copy the newest dumps over and restore them as above, and copy the uploads volume:

```bash
# On the old server:
docker run --rm -v jassmin_jassmin-strapi-uploads:/u -v /srv/jassmin:/out alpine tar czf /out/uploads.tgz -C /u .
# Copy uploads.tgz to the new server's /srv/jassmin, then there:
docker run --rm -v jassmin_jassmin-strapi-uploads:/u -v /srv/jassmin:/in alpine tar xzf /in/uploads.tgz -C /u
```

(`docker volume ls` shows the exact volume name.) Then move the DNS records to the new address.

## The owner's dashboard

`https://stats.<shop-domain>` (user `owner`, the `stats-password` parameter) shows the shop's real
sales, products, tester-to-bottle conversion, customers and the AI perfumer, in Ukrainian (#183,
`analytics/dashboard/README.md`). It's a static site, rebuilt every night by the `analytics`
service at 01:00 UTC (03:00 or 04:00 in Kyiv):

1. a read-only copy of the shop's data, without names, emails, phones, addresses or chat text, into
   the `jassmin_wh` database (`analytics/README.md` → Real data);
2. the dbt marts built and tested on it;
3. the site built and switched in, only if everything before succeeded.

If a night fails (a dbt data test, say), the site keeps the last good build and every page shows a
warning that the data is more than 36 hours old. Look at the log, fix the cause, and run the night
by hand:

```bash
docker compose logs --since 24h analytics                                    # the last runs
docker compose exec analytics bash /app/analytics/warehouse/scripts/nightly.sh  # run it now (a few minutes)
docker compose run --rm analytics-setup                                      # re-create the roles and grants
docker compose exec pg-backup psql -d jassmin_wh -c 'select * from meta.extract_runs order by finished_at desc limit 3'
```

- **The password:** change `stats-password` like any setting
  ([Changing a setting or a secret](#changing-a-setting-or-a-secret)); only `proxy` restarts.
- **`wh-pseudonym-key` must never change:** customers who order as guests are recognised by a keyed
  hash of their email, so a new key makes every guest a new customer (the history is rebuilt each
  night, so the counts change at once, but nothing is lost). The other `wh-*` passwords can change
  any time: the next deploy's `analytics-setup` sets them.
- **Memory:** Evidence's build needs about 3 GB for a few minutes, whatever the pages (measured:
  2 GB of RAM, the service's cap, plus about 2 GB of swap at the peak; about 3.5 minutes a night
  in all). That's why the server has swap ([Prepare the server](#2-prepare-the-server)) and
  `deploy/docker-compose.override.yaml` caps the service and makes it the first one the kernel
  stops if memory runs out. Nothing runs between nights; the site itself is static files served by
  Caddy. If `docker compose logs analytics` shows exit code 137, the build ran out of memory:
  check `free -h` (is the swap on?).
- **A new column in the app** doesn't reach the dashboard until it's added to
  `analytics/warehouse/extract/allowlist.py` (and deployed): the copy reads only listed columns.
- Until the shop has had its first visit, the night stops at a dbt test (there's no data yet) and
  the site keeps its "not built yet" page. That's expected.

## Troubleshooting

- **`pnpm aspire:deploy` fails at `push-…` with "denied":** `docker login ghcr.io` on your computer,
  with a token that has `write:packages`, and check `ghcr-repository` is `<github-user>/jassmin` in
  lowercase.
- **On the server, `docker compose pull` fails with "denied" or "unauthorized":** `docker login
  ghcr.io` as `deploy` with the `read:packages` token.
- **No certificate / the browser warns:** the DNS records don't point at the server yet, or ports 80
  and 443 are closed in the Hetzner firewall. `docker compose logs proxy` says which.
- **Images or the admin answer 502 for a few seconds after a deploy:** Strapi is still starting.
- **`web` doesn't start:** `docker compose logs db-migrate` (a failed migration stops the deploy
  there) and `docker compose logs web` (a missing or invalid setting is named in the error).
- **Shop pages from Strapi show an error:** the Strapi tokens are still `pending` or wrong (step 6),
  or `cms` is down (`docker compose logs cms`).
- **Product or order edits in Strapi fail with an error about the shop:** `web` is down; Strapi
  writes every product and order edit through to the shop before saving it (#40).
