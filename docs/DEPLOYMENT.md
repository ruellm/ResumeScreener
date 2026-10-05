# Deployment and operations

How Resume Screener is deployed and run on the server. For what the app is and how to run it
locally, see the [README](../README.md).

All values shown for keys, passwords and connection strings are placeholders.

## 1. Current production setup

- Ubuntu server shared with other apps.
- Address: `https://screener.oneoverzero.tech`.
- Next.js listens on port 3100 on localhost. Nginx terminates TLS and proxies to it.
- Two PM2 processes, defined in `ecosystem.config.cjs`:
  - `screener-web`: `next start`
  - `screener-worker`: `npm run worker`
- Code is in `/home/ResumeScreener`.
- Local development and production currently share one Supabase project and one Google account.

## 2. One-time external setup

### Supabase

1. Create the project.
2. **Storage > New bucket**: create two **private** buckets named exactly `resumes` and `results`.
   For each, set the allowed MIME type to `application/pdf` and the file size limit to 10 MB. The
   health endpoint reports a bucket as missing if it does not exist or is public.
3. **Authentication > Sign In / Providers > Email**: keep the Email provider on, turn
   **Allow new users to sign up** off, and set **Email OTP expiration** to `86400` seconds. That
   value is how long a set-password link stays valid.
4. **Authentication > URL Configuration**: set the Site URL to
   `https://screener.oneoverzero.tech` and add `https://screener.oneoverzero.tech/**` and
   `http://localhost:3000/**` to the redirect URLs. The app builds its own set-password links
   from `APP_BASE_URL` and does not depend on these, so this is a safeguard, not a requirement.
5. **Project Settings > API**: copy the project URL, the anon key and the service role key into
   `.env`.
6. **Connect** (top bar): copy the transaction pooler string into `DATABASE_URL` and add
   `?pgbouncer=true`. Copy the session pooler string into `DIRECT_URL`.

### Google Cloud

1. Create a project.
2. **APIs & Services > Library**: enable **Gmail API** and **Google Drive API**.
3. **Google Auth Platform > Branding** (the OAuth consent screen): user type **External**. Set the
   home page to `https://screener.oneoverzero.tech` and the privacy policy to
   `https://screener.oneoverzero.tech/privacy`. Both must be on an authorized domain, so add
   `oneoverzero.tech` under authorized domains.
4. **Data Access**: add the scopes the app asks for:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/drive`
5. **Audience**: set the publishing status to **In production**. In **Testing**, Google expires
   refresh tokens after 7 days and the connection breaks every week.
6. **Clients > Create client**: type **Web application**. Add both redirect URIs:
   - `http://localhost:3000/api/admin/google/callback`
   - `https://screener.oneoverzero.tech/api/admin/google/callback`

   The redirect URI the app sends is always `APP_BASE_URL` + `/api/admin/google/callback`.
7. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### System Gmail account

This is the account in `GOOGLE_SYSTEM_ACCOUNT`. Its inbox receives the resumes and its Drive holds
the folders.

1. Turn on 2-step verification.
2. In Gmail, **Settings > Filters and Blocked Addresses > Create a new filter**: put
   `filename:pdf` in "Has the words", then choose **Never send it to Spam**. The worker reads Spam
   as well, so this is for the humans who look at the inbox.

### DNS

Add an A record for `screener.oneoverzero.tech` pointing at the server's IP address.

## 3. Server requirements

- **Node.** Node 22 (22.13 or newer) is what the dependencies ask for: `@supabase/supabase-js`
  and `googleapis` declare Node 22 as their minimum, and `jsdom` needs 20.19 or newer on the
  Node 20 line. The server currently runs Node 20. That works with the flag described in
  [section 8](#8-node-20-note), but `npm ci` prints engine warnings and Node 20.19 is the lowest
  20.x that satisfies `jsdom`.
- PM2, Nginx and certbot.
- Memory for the build. The type check inside `next build` needs about 3 GB of heap. On a small
  server add swap first:

  ```bash
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

## 4. First deployment

1. Choose a free port. The default in `ecosystem.config.cjs` is 3100.

   ```bash
   sudo ss -ltnp | grep 3100
   ```

   No output means the port is free.

2. Clone the repo.

   ```bash
   cd /home
   git clone <repo-url> ResumeScreener
   cd /home/ResumeScreener
   ```

3. Create `.env`. Either copy your filled-in file to the server, or start from the example:

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

4. Set the values. Replace a whole line instead of appending, so nothing ends up glued to the
   previous line:

   ```bash
   sed -i 's|^APP_BASE_URL=.*|APP_BASE_URL=https://screener.oneoverzero.tech|' .env
   ```

   Use the same form for the other variables, or edit the file with `nano .env`. Do not use
   `echo "KEY=value" >> .env` unless you have checked that the file ends with a newline. To add a
   missing final newline:

   ```bash
   sed -i -e '$a\' .env
   ```

   To check a value without printing secrets:

   ```bash
   grep -c '^APP_BASE_URL=https://screener.oneoverzero.tech$' .env
   ```

   The port is **not** set in `.env`. Next.js reads `PORT` before it loads that file. The port
   comes from `ecosystem.config.cjs`, which uses the `PORT` of the shell that starts PM2, or 3100
   when it is not set. See step 10.

5. Install the packages.

   ```bash
   npm ci
   ```

6. Generate the Prisma client.

   ```bash
   npm run db:generate
   ```

7. Apply the migrations.

   ```bash
   npx prisma migrate deploy
   ```

8. Seed the settings row and the skill catalogue. Only needed on a database that has never been
   seeded. It is safe to run again.

   ```bash
   npx prisma db seed
   ```

9. Build. The `build` script is plain `next build`, so the heap size is given on the command
   line:

   ```bash
   NODE_OPTIONS=--max-old-space-size=3072 npm run build
   ```

10. Start both processes.

    ```bash
    pm2 start ecosystem.config.cjs
    ```

    For a port other than 3100:

    ```bash
    PORT=3200 pm2 start ecosystem.config.cjs
    ```

11. Save the process list and make PM2 start on boot.

    ```bash
    pm2 save
    pm2 startup
    ```

    `pm2 startup` prints a command. Run it once if it has not been done on this server. On a
    server that already runs PM2 for other apps, `pm2 save` is enough.

12. Create the Nginx site, for example `/etc/nginx/sites-available/screener.oneoverzero.tech`:

    ```nginx
    server {
        listen 80;
        listen [::]:80;
        server_name screener.oneoverzero.tech;

        location / {
            proxy_pass http://127.0.0.1:3100;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_read_timeout 120s;
        }
    }
    ```

    The `Host` header must be passed on. Next.js compares it with the browser's `Origin` and
    refuses form submissions when they differ. Resume uploads go from the browser straight to
    Supabase, so no large body limit is needed here.

13. Enable the site, test and reload.

    ```bash
    sudo ln -s /etc/nginx/sites-available/screener.oneoverzero.tech /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl reload nginx
    ```

14. Get the certificate. certbot adds the HTTPS server block and the redirect.

    ```bash
    sudo certbot --nginx -d screener.oneoverzero.tech
    ```

15. Check health.

    ```bash
    curl -s http://127.0.0.1:3100/api/health
    curl -s https://screener.oneoverzero.tech/api/health
    ```

    A healthy answer is HTTP 200 with:

    ```json
    {"db":"ok","buckets":{"resumes":true,"results":true}}
    ```

    HTTP 503 means the database is unreachable or a bucket is missing or public.

## 5. After the first deploy, in the app

1. Create the super admin on the server. The script prints a one-time set-password link.

   ```bash
   cd /home/ResumeScreener
   npm run create-superadmin -- you@example.com
   ```

2. Open the link, set a password and sign in.
3. Go to `/admin/settings`. Under **Google account**, click **Connect**, choose the system
   account and allow all three permissions. Click **Test connection** to confirm.
4. On the same page, switch on **Email intake** and **Drive intake**. Mail received before Email
   intake was first switched on is never read. Switching Drive intake on creates the
   `Resume Screener` folder in the system account's Drive, and the worker then creates the
   business and job folders.
5. Go to `/admin`, click **New business**, then add its users on the business page. Each new user
   gets a set-password link that is shown once. Copy it and send it to them. The app sends no
   account emails.

## 6. Updating

```bash
cd /home/ResumeScreener
git pull
npm ci
npm run db:generate
npx prisma migrate deploy
NODE_OPTIONS=--max-old-space-size=3072 npm run build
pm2 restart screener-web screener-worker
```

Notes:

- The build replaces `.next` while the old web process is still serving from it. Restart right
  after the build. Users with an open page may need a hard refresh.
- The worker finishes the submissions it is working on before it exits. PM2 waits up to 35
  seconds for that.
- A change to `GOOGLE_SYSTEM_ACCOUNT` needs a rebuild, because `/privacy` is a static page that
  takes the contact address at build time. The same goes for `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which are built into the browser bundle.
- Other `.env` changes only need `pm2 restart screener-web screener-worker`.

## 7. Operations

### Logs

```bash
pm2 logs screener-web
pm2 logs screener-worker
pm2 logs screener-worker --lines 200
pm2 flush
```

`pm2 flush` empties the log files of all PM2 apps on the server, not only these two.

The worker logs each submission (claimed, evaluating, done or failed), each email and Drive file
it handles, and lines starting with `email:`, `drive:` and `purge:` for the background tasks.

### Health and heartbeat

- `GET /api/health` checks the database and the two storage buckets. It needs no login.
- The worker writes a heartbeat every 15 seconds. `/admin/settings` shows **Worker last seen**,
  **Last mail check** and **Last Drive check**.
- Job pages show "Checks every 30 seconds. Last check: ..." on the intake panels. When the worker
  has not been seen for 3 minutes they show "Intake is paused. The background worker may not be
  running."

### Admin pages

| Page | Use |
|---|---|
| `/admin` | Businesses and their users, limits and retention. |
| `/admin/skills` | The skill catalogue. |
| `/admin/intake` | Every inbound email and Drive file across all businesses, with status and reason. Includes mail that matched no business. |
| `/admin/events` | The event log, with filters by business, type prefix and date. |
| `/admin/settings` | Retention and file size limits, the Google account, the intake switches, models and heartbeat. |

### Kill switches

Both are on `/admin/settings` and take effect at the worker's next check.

- **Email intake** off: the mailbox is no longer read. Replies for mail that was already
  accepted still go out.
- **Drive intake** off: Drive is no longer read and no results are written back. Deleting a
  submission or purging still removes its files from Drive.

Web uploads are not affected by either switch. To stop all processing, stop the worker:
`pm2 stop screener-worker`.

### Retention

- The worker checks once an hour and runs the purge when the last one is more than 24 hours old.
- Each business has a retention period in days. Without its own value it uses the default. The
  default, minimum and maximum are on `/admin/settings` (180, 180 and 365 days out of the box).
- The purge deletes finished submissions older than the period, with their stored resume, result
  PDF, and the result and note files in Drive. It also deletes old inbound email and Drive intake
  records, and event log rows older than the maximum retention. Usage records are kept.
- A resume file in Drive belongs to the person who uploaded it. Google usually refuses to delete
  it, and the purge carries on.

Run it by hand:

```bash
cd /home/ResumeScreener
npm run purge -- --dry-run
npm run purge
```

`--dry-run` only reports what would be deleted.

### Reconnecting Google

When Google rejects the stored token (password change, access removed, token expired), the worker
logs `Google account not connected`, the event log gets `google.token_invalid`, and
`/admin/settings` shows a red notice under **Google account**.

1. Open `/admin/settings`.
2. Click **Reconnect** and sign in as the system account.
3. Click **Test connection**.

Intake resumes by itself at the next check. Nothing is lost: mail and Drive changes from the gap
are picked up.

### Running a worker locally

Local and production share the database, the mailbox and the Drive. A local worker handles real
submissions, real mail and real files.

1. Stop the server worker: `pm2 stop screener-worker`.
2. Run the local worker.
3. Stop it, then start the server worker again: `pm2 start screener-worker`.

## 8. Node 20 note

The Supabase client needs a global `WebSocket`. Node 22 has one. Node 20 only has it behind a
flag, so `ecosystem.config.cjs` starts the worker with:

```js
env: { NODE_OPTIONS: "--experimental-websocket" },
```

Without it the worker stops at startup with "native WebSocket not found". On Node 22 the line is
not needed and can be removed.

To run the worker or a script by hand on Node 20:

```bash
NODE_OPTIONS=--experimental-websocket npm run worker
NODE_OPTIONS=--experimental-websocket npm run purge -- --dry-run
```

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build is killed, or `JavaScript heap out of memory` | Not enough memory for the type check. | Add swap ([section 3](#3-server-requirements)) and build with `NODE_OPTIONS=--max-old-space-size=3072 npm run build`. |
| Worker crashes with `native WebSocket not found` | Node 20 without the WebSocket flag. | Keep `NODE_OPTIONS: "--experimental-websocket"` in `ecosystem.config.cjs`, or move to Node 22. |
| A variable has another variable's text stuck to its value | `.env` had no final newline and a line was appended. | Fix the line, then run `sed -i -e '$a\' .env`. Restart both processes. |
| App fails to start with a validation error naming a variable | A required variable is missing or malformed, for example `GOOGLE_TOKEN_ENCRYPTION_KEY` is not 32 bytes of base64. | Correct `.env` and restart. |
| `prepared statement "s0" already exists` | `DATABASE_URL` lacks `?pgbouncer=true`. | Add it and restart both processes. |
| Emails are not processed | In order of likelihood: the worker is not running; **Email intake** is off; the mail arrived before intake was first switched on; the sender could not be verified or is not on the allowed senders list. | Check **Worker last seen** on `/admin/settings`, then the switch, then find the message on `/admin/intake`, which shows the status and the reason. A message in Spam is still read. |
| Email was accepted but no reply arrived | Replies go out only when every resume of the email is done or failed. After 5 failed sends the row is marked "Reply failed". | Look at the row on `/admin/intake` and at `pm2 logs screener-worker`. |
| A Drive file is not processed | It was uploaded by the system account itself; the uploader is not an allowed sender by exact email address (a domain entry is not enough for Drive); **Drive intake** is off; or the worker is not running. | Check `/admin/intake`, Drive tab. Add the uploader's address to the business's allowed senders. |
| A file in Drive got a `_SKIPPED.txt` next to it | The file was refused. The note holds the reason. | Fix the cause and upload the file again. A file that was already seen is not read twice. |
| "Intake is paused. The background worker may not be running." | No heartbeat for 3 minutes. | `pm2 status`, then `pm2 restart screener-worker` and read its log. |
| Red notice under Google account on `/admin/settings` | Google rejected the stored token. | Reconnect. See [Reconnecting Google](#reconnecting-google). |
| `conflicting server name` warnings from `nginx -t` | A second file in `sites-enabled` declares the same name, typically a `.bak` copy. | Move backup files out of `sites-enabled`, then test and reload. |
| `Server Action ... was not found on the server` in the browser | The page was loaded before the last build. | Hard refresh. |

## 10. Security notes

- Secrets live only in `.env` on the server, with `chmod 600`. `.env` is ignored by git. Never
  commit it or paste its values into tickets or chat.
- The system Google account holds all candidate data that arrives by email or Drive. Keep 2-step
  verification on and do not share its login.
- The Google refresh token is stored encrypted (AES-256-GCM) with
  `GOOGLE_TOKEN_ENCRYPTION_KEY`. The database alone is not enough to use it.
- Row level security is enabled on every table with no policies. The app reaches the database
  only from the server, through Prisma and the service role, so the public anon key can read and
  write nothing.
- Both storage buckets are private. Files are handed out through short-lived signed links.
- The root Drive folder is never shared. Business folders are shared only with allowed senders
  that are single addresses. The hourly audit removes any other sharing, including link sharing.
- Only verified senders on a business's allowed list get a reply by email. Everyone else gets
  none, so the mailbox cannot be used to probe for jobs.
- Job import fetches only public web pages. Private, local and link-local addresses, other
  ports and other protocols are refused.

## 11. Known follow-ups

- Move the server to Node 22 and remove the WebSocket flag.
- Run the worker from a compiled build instead of through `tsx`.
- Separate the development and production Supabase projects and Google accounts.
- Add an automated test suite to the repo. The current checks are fixtures and manual scripts.
