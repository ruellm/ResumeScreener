# Resume Screener

AI resume screening for hiring teams.

A business creates jobs. Resumes then arrive in one of three ways: uploaded on the web, emailed to
the system Gmail inbox, or dropped into a shared Google Drive folder. Each resume gets an
evidence-based evaluation (verdict, score, requirements, skills) and a result PDF.

Deployment and server operation are covered in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Stack

- Next.js 15.5 (App Router), React 19, Tailwind 4
- Prisma 6 on Supabase Postgres
- Supabase Auth (email and password) and Supabase Storage
- A separate Node worker. There is no queue service: the `Submission` table is the queue.
- Anthropic API: one model for evaluation, one for importing job posts
- Google Gmail and Drive APIs through one system Google account

## Architecture

There are two processes. Both read the same `.env` and the same database.

**Web app** (`next dev` or `next start`)

- The public pages `/` and `/privacy`, and login.
- `/app`: the business area. Jobs, uploads, results, allowed senders, activity.
- `/admin`: the super admin area. Businesses, users, skills, settings, intake and event logs.
- It never evaluates a resume. It creates rows and the worker picks them up.

**Worker** (`npm run worker`, source in `src/worker/`)

| Task | How often | What it does |
|---|---|---|
| Submission queue | every `WORKER_POLL_MS` | Claims `QUEUED` submissions, extracts the PDF text, calls the evaluation model, saves the result and renders the result PDF. Up to `WORKER_CONCURRENCY` at a time. A failed attempt is retried after 30 and then 120 seconds, three attempts in total. |
| Sweep | every 10 seconds | Fails submissions whose lease expired too often, removes uploads that were never confirmed after 60 minutes, and closes email and Drive rows stuck in processing for 15 minutes. |
| Heartbeat | every 15 seconds | Writes `Settings.workerSeenAt`. The pages use it to show "Intake is paused" when the worker is down. |
| Email poller | every `EMAIL_POLL_MS` | Reads new mail in the system inbox when Email intake is on. |
| Reply sender | every 15 seconds | Sends the results reply once every resume of an email has finished, and retries replies that failed. |
| Drive poller | every `DRIVE_POLL_MS` | When Drive intake is on: creates missing folders, updates folder sharing, reads new files, writes result PDFs and failure notes back to the job folder. |
| Drive audit | hourly | Removes sharing that should not be there on the root, business and job folders. |
| Retention purge | checked hourly, runs once every 24 hours | Deletes data past the retention period. |

### How a resume gets to a result

**Web upload**

1. The browser asks the server to prepare the upload. The server creates a `RECEIVED` row and a
   signed upload URL.
2. The browser uploads the PDF straight to Supabase Storage (bucket `resumes`).
3. The browser confirms. The server checks the stored file and sets the row to `QUEUED`.
4. The worker extracts the text, evaluates it, sets the row to `DONE` and stores the result PDF
   (bucket `results`).

**Email**

1. Someone sends PDFs to the system mailbox with the job code. The code is either a plus address,
   `name+<alias>@...`, or `JOB-<ALIAS>` in the subject. Both are shown on the job page.
2. The worker reads the message. Automatic mail (bounces, lists, auto-replies) is ignored.
3. The sender is verified from Gmail's own `Authentication-Results` header (DMARC, DKIM or SPF
   aligned with the From domain).
4. The sender must be on the business's allowed senders list, by address or by domain.
5. Each PDF is checked (size, real PDF, not a duplicate in the job), stored and queued.
6. When every resume of the email has finished, the worker replies in the same thread with the
   results and the result PDFs.
7. The message is labelled `Screener/Processed` or `Screener/Rejected` in Gmail.

**Google Drive**

1. The worker keeps a folder tree in the system account's Drive: `Resume Screener`, then one
   folder per business, then one folder per job named `<title> (JOB-<ALIAS>)`.
2. Each business folder is shared with the allowed senders that are single email addresses.
   Domain entries are never shared.
3. An allowed sender drops a PDF into a job folder.
4. The worker sees the change, checks the uploader and the file, stores it and queues it.
5. The result is written next to the file as `<name>_RESULTS.pdf`. A file that was not taken gets
   `<name>_SKIPPED.txt`, and one that failed evaluation gets `<name>_FAILED.txt`.

## Repo layout

| Path | What lives there |
|---|---|
| `src/app/` | Next.js routes. `app/` is the business area, `admin/` the super admin area, `api/` the route handlers, `login/`, `set-password/` and `auth/confirm/` the sign-in flow, `privacy/` the privacy page. |
| `src/components/` | Shared React components. `ui/` holds the shadcn components. |
| `src/lib/` | Code shared by the web app and the worker: database client, auth, env validation, job and sender rules, retention, result PDF rendering. |
| `src/lib/google/` | Google OAuth, token encryption, the Drive wrapper and Drive folder handling. |
| `src/lib/job-import/` | Importing a job post: safe fetch, content extraction, model call, blocked sites. |
| `src/lib/supabase/` | Supabase clients for the browser, the server and the service role. |
| `src/worker/` | The worker. `index.ts` is the loop, `pipeline.ts` and `stages/` process a submission, `extraction/` reads PDFs, `evaluation/` calls the model, `email/` and `drive/` are the two intake channels, `purge.ts` is retention. |
| `src/middleware.ts` | Refreshes the session and sends signed-out visitors of `/app` and `/admin` to `/login`. |
| `prisma/` | `schema.prisma`, `migrations/`, `seed.ts` and `seed-data/skills.json`. |
| `scripts/` | Command line scripts. See [Scripts](#scripts). |
| `test-fixtures/` | Synthetic PDF resumes, and `job-import/` with HTML pages for the import extraction. |
| `ecosystem.config.cjs` | PM2 definition of the two production processes. |
| `docs/` | Deployment and operations. |

## Environment variables

Copy `.env.example` to `.env` and fill it in. The file must end with a newline. Without one, the
next value appended by a tool or by hand lands on the same line as the last variable.

The web app and the worker validate these on startup and stop with an error when one is missing.

| Variable | Needed by | Purpose and format |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | both | Supabase project URL, for example `https://<project-ref>.supabase.co`. Built into the browser bundle, so a change needs a rebuild. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | both | Supabase anon (public) key. Also built into the browser bundle. |
| `SUPABASE_SERVICE_ROLE_KEY` | both | Supabase service role key. Server side only. Never expose it. |
| `DATABASE_URL` | both | Postgres connection used at runtime. Must be the Supabase **transaction pooler** (port 6543) with `?pgbouncer=true` at the end. |
| `DIRECT_URL` | both | Postgres connection used by Prisma migrations. Must be the Supabase **session pooler** (port 5432). |
| `ANTHROPIC_API_KEY` | both | The worker uses it for evaluations, the web app for job import. |
| `APP_BASE_URL` | both | Public address of the app without a trailing path, for example `http://localhost:3000`. Used for the Google redirect URI, set-password links and the links in result emails. Defaults to `http://localhost:3000` when empty. |
| `GOOGLE_CLIENT_ID` | both | OAuth client ID of the Google Cloud project. |
| `GOOGLE_CLIENT_SECRET` | both | OAuth client secret. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | both | Key that encrypts the stored Google refresh token. 32 random bytes, base64. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Changing it makes the stored token unreadable, so the Google account has to be connected again. |
| `GOOGLE_SYSTEM_ACCOUNT` | both | Email address of the system Google account. Only this account can be connected. Also shown as the contact address on `/privacy`. |
| `WORKER_CONCURRENCY` | worker | Submissions processed at the same time. Optional, default `3`. |
| `WORKER_POLL_MS` | worker | How often the queue is checked. Optional, default `2000`. |
| `WORKER_LEASE_SECONDS` | worker | How long a claimed submission stays locked before another attempt may take it. Optional, default `300`. |
| `WORKER_STUB_DELAY_MS` | worker | Still validated, but nothing in the current worker reads it. Optional, default `1500`. |
| `EMAIL_POLL_MS` | both | How often the worker checks for new mail. The web app reads it for the "Checks every ..." text. Optional, default `30000`. |
| `DRIVE_POLL_MS` | both | How often the worker checks Google Drive. Same use in the web app. Optional, default `30000`. |

`PORT` is not read from `.env`. See the deployment doc for how the production port is set.

## Local development

Prerequisites: Node 22 (22.13 or newer) and npm. Several dependencies declare Node 22 as their
minimum.

> Local and production currently share one Supabase project and one Google account. That has
> three consequences:
> - Never run a local worker while the server worker is running. Two workers on one mailbox and
>   one Drive is supported by the code, but a local worker with unfinished code will handle real
>   mail and real files.
> - `npx prisma migrate dev` changes the production database.
> - Jobs, resumes and settings you create locally are production data.

1. Install the packages.

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example` and fill it in.

3. Generate the Prisma client.

   ```bash
   npm run db:generate
   ```

4. Apply the migrations.

   ```bash
   npx prisma migrate dev
   ```

5. Seed the settings row and the skill catalogue. This is safe to repeat.

   ```bash
   npx prisma db seed
   ```

   The seed creates the single `Settings` row with the evaluation model `claude-sonnet-5`. The
   app does not start without that row.

6. Create the first super admin. The script prints a one-time link for setting the password.

   ```bash
   npm run create-superadmin -- you@example.com
   ```

7. Start the web app in one terminal.

   ```bash
   npm run dev
   ```

8. Start the worker in a second terminal. Read the warning above first.

   ```bash
   npm run worker:dev
   ```

The app is at `http://localhost:3000`. Sign in, then use `/admin` to create a business and its
users. New users also get a set-password link that you copy and send to them. The app sends no
account emails.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js development server on port 3000. |
| `npm run build` | Production build. |
| `npm run start` | Serves the production build. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | TypeScript check without output. |
| `npm run db:generate` | Generates the Prisma client. |
| `npm run create-superadmin -- <email>` | Creates a super admin if needed and prints a set-password link. |
| `npm run worker` | Runs the worker once, as in production. |
| `npm run worker:dev` | Runs the worker and restarts it when a file changes. |
| `npm run purge -- [--dry-run]` | Runs the retention purge now, whether or not it is due. With `--dry-run` it only reports. |
| `npm run make-fixtures` | Rewrites the synthetic PDFs in `test-fixtures/`. |
| `npm run make-test-jobs -- <businessId>` | Creates two sample jobs for a business. |
| `npm run upload-test -- <jobId> <file...>` | Stores PDF files and queues them for a job, bypassing the browser. `-- --cleanup` removes what it created. |
| `npm run enqueue-test -- <jobId> [count] [--fail]` | Queues placeholder submissions with no file, to watch the queue work. `-- --cleanup` removes them. |
| `npm run show-extraction -- <submissionId>` | Prints what the worker extracted from a submission. |

Database commands are run through Prisma directly: `npx prisma migrate dev` locally,
`npx prisma migrate deploy` on the server, `npx prisma db seed` for the seed and
`npx prisma migrate status` to check.

## Testing

There is no automated test suite in the repo and no `npm test`. What exists is a set of fixtures
and helper scripts for trying the pipeline by hand.

- `test-fixtures/*.pdf`: invented resumes that cover the cases the pipeline has to handle: a
  strong and a weak match, scanned pages, hidden text, a visible instruction to the AI, an
  encrypted file, a file that is not a PDF, a long resume. `npm run make-fixtures` regenerates them.
- `test-fixtures/job-import/*.html`: saved pages for the job import extraction.
- A typical manual run:

  ```bash
  npm run make-test-jobs -- <businessId>
  npm run upload-test -- <jobId> test-fixtures/dev-strong.pdf test-fixtures/scanned.pdf
  npm run worker
  npm run show-extraction -- <submissionId>
  npm run upload-test -- --cleanup
  ```

**API budget.** Every submission queued with `upload-test` or uploaded in the browser is
evaluated by the worker, and each evaluation is a paid Anthropic call. Importing a job post is one
call to the import model. `enqueue-test` costs nothing: its rows have no file, so they fail before
the model is called.

Remember the shared setup: a worker started for a test also reads the real mailbox and Drive when
the intake switches are on.

## Known pitfalls in development

| Symptom | Cause | Fix |
|---|---|---|
| `prepared statement "s0" already exists` | `DATABASE_URL` points at the transaction pooler without `?pgbouncer=true`. | Add `?pgbouncer=true` to `DATABASE_URL` and restart. |
| `Cannot find module './NNN.js'` (a number) from inside `.next` | `npm run build` ran while the dev server was running, so the two wrote into the same `.next` folder. | Stop the dev server, delete `.next`, start it again. Do not build while it runs. |
| `Server Action "..." was not found on the server` after a rebuild | The open browser tab still holds the action ids of the old build. | Hard refresh the page. |
| A setting in `.env` seems to be ignored | Another source wins. Next.js prefers real environment variables and `.env.local` over `.env`. The worker reads only `.env`, and a variable that already exists in the environment (for example a Windows user variable) is not replaced by the file. | Remove the variable from `.env.local` or from the Windows environment, then restart the process. |
| `prisma generate` fails with `EPERM ... query_engine-windows.dll.node` | The dev server or worker holds the Prisma engine file open. | Stop them, run the command, start them again. |
