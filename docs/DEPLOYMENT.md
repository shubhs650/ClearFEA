# Deploying the live closed beta

How the maintainer sets up and runs `clearfea.triyalabs.com` for the closed beta (ADR-095, redesigned in M11 to M17, ADR-106 to ADR-119). Written for someone who is not a DevOps engineer: every step says where to click and what to copy where. You do the setup once. After that, every merge to `main` goes live by itself.

Self-hosting on your own machine is a different procedure: see `SELF_HOSTING.md`.

Once the site is up, running the beta day to day (inviting, removing, settings, costs, the tutorial trial) is in `ADMIN_GUIDE.md`. That guide still describes the AWS machines in places; M17.5 brings it up to date.

> **Status (2026-10-23).** The website, API, database and files run on Cloudflare behind Cloudflare Access, and every merge to `main` deploys them (sections 1 to 3, 5 and 6 are current). The solver moves from AWS to one always-on Contabo VPS (ADR-106): AWS is switched off and was deleted on 2026-10-23 (section 7.6), so **the live site solves nothing until M12.7**. The compute manager that runs on the VPS (M12.1 to M12.3) and the API's VPS mode (M12.4) are on `main`; the VPS setup (bootstrap script, systemd units, environment template, image updater, and the deploy storing the worker image in R2, M12.5) is on `main` too, and section 4.3 is how you set the VPS up with it. Check that a task is ticked in `PROGRESS.md` before doing a step that names it.

## What you are setting up

| Piece | Service | What it does | Monthly cost (closed beta) |
| --- | --- | --- | --- |
| Website, API, sign-in | Cloudflare Workers (Paid plan) | Serves the landing page and the app at `clearfea.triyalabs.com`, runs the API | $5 |
| Database | Cloudflare D1 | Projects, simulations, runs, ledger, allowlist, events, statistics | Included |
| Files | Cloudflare R2 | STEP files, meshes, results, reports (and, from M12.5, the worker image) | Free up to 10 GB |
| Hiding the site | Cloudflare Zero Trust (Access) | Only people and machines you let in reach the site until the public beta (ADR-111) | Free plan |
| Google sign-in | Google Cloud (OAuth client) | "Sign in with Google" | Free |
| Solver host | Contabo Cloud VPS 8 (8 vCPU, 24 GB, NVMe), monthly plan paid in advance | Always on; its compute manager takes jobs from the API and runs each in its own container (ADR-106, ADR-107) | About $17 |
| Automatic deploys | GitHub Actions | Tests and deploys every merge to `main` | Within the minutes GitHub includes for private repositories |

AWS is no longer part of the closed beta (ADR-106). Its launcher code and stack template stay in the repository, unused, for production later (appendix A).

All passwords and keys for the site live in **one place: GitHub repository secrets**. The deploy workflow copies them to Cloudflare. The solver host has its own copy of the few it needs, in a file only root can read on the VPS (section 4). Never paste a secret into a chat, an issue, a pull request or a file in the repository.

Two kinds of values go into GitHub:

- **Secrets** (hidden after saving): GitHub → the ClearFEA repository → **Settings** → **Secrets and variables** → **Actions** → **Secrets** tab → **New repository secret**.
- **Variables** (visible, not sensitive): same page, **Variables** tab → **New repository variable**.

Keep a private note (a password manager is best) of what you created, since some values are shown only once.

### Order

| Step | Needed by task | Section | State |
| --- | --- | --- | --- |
| Cloudflare plan, R2, D1, tokens | M10.1, M10.2 | 1 | Done |
| Google sign-in client | M10.3 | 2 | Done |
| Random keys | M10.3, M10.6, M10.9 | 3 | Done |
| R2 API token | M10.5 | 1.7 | Done |
| Access service token | M11.1 | 1.8 | Done |
| GitHub secrets and variables | as each value is made | 5 | Check the AWS ones are gone (5) |
| First deploy, invite colleagues | M10.2 onwards, M10.10 | 6 | Done |
| Delete AWS | ADR-106 | 7.6 | Done (2026-10-23) |
| Order the VPS with your SSH key | M12.5 | 4.1 | Done (2026-10-23) |
| Set the VPS up | M12.5 | 4.3 | To do (the scripts are on `main`) |
| Switch the site to the VPS | M12.7 | 4.5 | Waits on M12.7 |

## 1. Cloudflare

You already have `triyalabs.com` in your Cloudflare account, since you bought it there.

### 1.1 Check the domain is active

1. Sign in at <https://dash.cloudflare.com>.
2. Click **triyalabs.com** in the list of domains. Its status should read **Active**.

You do not need to create a DNS record for `clearfea`. The first deploy adds it as a Worker custom domain, with its certificate.

### 1.2 Upgrade to Workers Paid ($5 a month)

The free plan allows only 10 ms of processor time per request, which ClearFEA's API goes over.

1. In the left menu, open **Compute (Workers)** (it may be called **Workers & Pages**).
2. Open **Plans** (or the **Upgrade** button on the overview page).
3. Choose **Workers Paid**, $5 per month, and confirm with your payment card.

### 1.3 Turn on R2 and create the bucket

1. Left menu → **R2 Object Storage**. If asked, add a payment method; the first 10 GB stored each month are free.
2. **Create bucket**. Name: `clearfea-files`. Location: Automatic. Default storage class: Standard. **Create bucket**.
3. Leave public access **off**. Files are only ever reached through the API or through short-lived signed links.

### 1.4 Create the database

1. Left menu → **Storage & Databases** → **D1 SQL Database** → **Create database**.
2. Name: `clearfea`. Location: Automatic. **Create**.
3. On the database page, copy the **Database ID** (a long id like `1a2b3c4d-...`).
4. In GitHub, add the **variable** `CLOUDFLARE_D1_DATABASE_ID` with that id. (An id is not a secret.)

### 1.5 Copy your Account ID

1. Go back to the account home (click your account name top left) and open **Compute (Workers)**, or open the **triyalabs.com** overview page.
2. On the right side there is **Account ID** with a copy button. Copy it.
3. In GitHub, add the **variable** `CLOUDFLARE_ACCOUNT_ID`.

### 1.6 Create the deploy token

This token lets GitHub deploy the site. It cannot touch anything outside your account and the `triyalabs.com` zone.

1. Top right, the person icon → **My Profile** → **API Tokens** → **Create Token**.
2. Next to **Edit Cloudflare Workers**, click **Use template**.
3. Under **Permissions**, keep what the template lists and **add** two rows:
   - **Account** · **D1** · **Edit**
   - **Zone** · **DNS** · **Edit**
4. **Account Resources**: Include · *your account*.
5. **Zone Resources**: Include · Specific zone · `triyalabs.com`.
6. Leave Client IP filtering and TTL empty. **Continue to summary** → **Create Token**.
7. Copy the token (it is shown once). In GitHub, add the **secret** `CLOUDFLARE_API_TOKEN`.

### 1.7 Create the R2 API token (for task M10.5)

The API uses this to give the solver signed links to its files.

1. Left menu → **R2 Object Storage** → **Manage API tokens** (on the right of the R2 overview) → **Create API token**.
2. Name: `clearfea-presign`. Permissions: **Object Read & Write**. Specify bucket: **Apply to specific buckets only** → `clearfea-files`. TTL: Forever.
3. **Create API Token**. The next page shows an **Access Key ID** and a **Secret Access Key**, once.
4. In GitHub, add the **secrets** `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.

The deploy names the account and bucket for these links itself (from `CLOUDFLARE_ACCOUNT_ID` and the bucket in `wrangler.jsonc`). Until both secrets are set, the solver moves files through the API instead, which works only for files under 100 MB (ADR-098).

### 1.8 Let machines and checks through Cloudflare Access (for task M11.1)

The site is behind Cloudflare Access until the public beta, so a program (the solver host, the deploy's health check, the **Live checks** workflow, the verification harness) gets Access's sign-in page instead of the API unless it sends a **service token** (ADR-111). People still sign in to Access as before.

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Service auth** → **Service Tokens** → **Create Service Token**. Name: `clearfea-machines`. Duration: **Non-expiring**. **Generate token**.
2. The next page shows a **Client ID** (ending in `.access`) and a **Client Secret**, once. Copy both into your private note.
3. **Access** → **Applications** → the application for `clearfea.triyalabs.com` → **Policies** → **Add a policy**. Name: `Machines`. Action: **Service Auth**. Include: **Service Token** → `clearfea-machines`. **Save**. Keep the existing policy for people beside it.
4. In GitHub, add the **secrets** `CF_ACCESS_CLIENT_ID` (the Client ID) and `CF_ACCESS_CLIENT_SECRET` (the Client Secret).
5. The solver host gets the same two values as `CLEARFEA_ACCESS_CLIENT_ID` and `CLEARFEA_ACCESS_CLIENT_SECRET` (section 4.2). To run the harness against the live site from your own computer, set those two as well.

The dashboard's menu names change now and then; if one is not where this says, search the Zero Trust dashboard for "Service Tokens". Check it worked: `curl -A test -H "CF-Access-Client-Id: ..." -H "CF-Access-Client-Secret: ..." https://clearfea.triyalabs.com/api/health` prints JSON with `"status":"ok"`; without the two headers it prints nothing (a redirect to Access). If the deploy's last step says "Cloudflare Access refused the health check", one of steps 3 and 4 is missing or the token was copied wrongly.

## 2. Google sign-in (for task M10.3)

### 2.1 Create a Google Cloud project

1. Go to <https://console.cloud.google.com> and sign in with your admin Gmail.
2. Top bar → project picker → **New project**. Name: `ClearFEA`. **Create**, then select it.

### 2.2 Set up the consent screen

1. Menu → **APIs & Services** → **OAuth consent screen** (it may open as **Google Auth Platform** → **Branding**). **Get started**.
2. App name: `ClearFEA`. User support email: your Gmail. **Next**.
3. Audience: **External**. **Next**.
4. Contact information: your Gmail. **Next**, agree, **Create**.
5. **Branding**: add the app home page `https://clearfea.triyalabs.com` and under **Authorized domains** add `triyalabs.com`. **Save**.
6. **Data access**: **Add or remove scopes** → tick `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. **Update**, **Save**.
7. **Audience**: leave the publishing status at **Testing**. Under **Test users** → **Add users**, add your own Gmail and each colleague's Gmail. In Testing mode, only these accounts can sign in at all, which is a second lock on top of ClearFEA's own allowlist.

### 2.3 Create the OAuth client

1. **Clients** (or **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**).
2. Application type: **Web application**. Name: `ClearFEA web`.
3. **Authorized JavaScript origins**: `https://clearfea.triyalabs.com`
4. **Authorized redirect URIs**: `https://clearfea.triyalabs.com/api/auth/callback/google`
5. **Create**. Copy the **Client ID** and the **Client secret**.
6. In GitHub, add the **secrets** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
7. In GitHub, add the **variable** `ADMIN_EMAIL` with your admin Gmail address. That account is always allowed in and is the only one that sees the admin dashboard.

Your colleagues' addresses do **not** go into GitHub. You add them on ClearFEA's admin dashboard after the first deploy (section 6.3).

## 3. Random keys (for tasks M10.3, M10.6 and M10.9)

Make long random strings. Either use your password manager's generator (40 or more characters, letters and digits), or run this in a terminal (Git Bash, WSL, macOS or Linux), once for each:

```
openssl rand -base64 32
```

| GitHub secret | What it is |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signs sign-in sessions. Changing it signs everyone out. |
| `WORKER_TOKEN` | The key the solver host's compute manager and its job containers use to talk to the API. The same value goes into the VPS's environment file (4.3). Changing it means changing it in both places, or the host stops getting jobs. |
| `VERIFY_TOKEN` | For the live checks (M10.9): signs the verification account in, so the checks run without a Google account. At least 32 characters; leave it out and that sign-in does not exist. Changing it ends the account's sign-in. |

## 4. The solver VPS (tasks M12.5 and M12.7)

The solver runs on one Contabo Cloud VPS 8 that is always on (ADR-106). It opens no port to the internet except SSH with your key: its compute manager asks the API for work, the same way the local worker does, so nothing on the internet calls into it. **Nothing creates, replaces or restarts a VPS automatically** (your decision, 2026-10-22): you order it once, and when it stops you restart it by hand (4.4).

### 4.1 Order the VPS with your SSH key (needed before M12.5 can start)

1. Make an SSH key on your own computer if you have none. In a terminal (PowerShell on Windows, Terminal on macOS or Linux):

   ```
   ssh-keygen -t ed25519 -C clearfea-vps
   ```

   Press Enter to keep the suggested file and choose a passphrase. The **public** key is the file ending in `.pub` (for example `~/.ssh/id_ed25519.pub`); that one goes to Contabo. The other file is the private key: it never leaves your computer.
2. At <https://contabo.com> order **Cloud VPS 8** on a **monthly** term paid in advance. Pick the region nearest you and your colleagues.
3. On the order page, add your public key where Contabo asks for the login (SSH key), so the VPS accepts your key from its first start. Contabo's page names change now and then; if you already ordered it with a password only, add the key later in the customer control panel or tell the M12.5 thread.
4. Operating system: **Ubuntu 24.04** (22.04 also works). The bootstrap script (4.3) checks the version and stops on anything else.
5. When Contabo's email arrives, note the VPS's **IP address** in your private note. Contabo's customer control panel (<https://my.contabo.com>) is where you see, restart and reinstall it.

A thread needs only the IP address and that the key is on it; it never needs your private key or your Contabo password.

### 4.2 What runs on the VPS (as built on `main`)

- **The compute manager** (M12.1, ADR-107, ADR-121): `python -m clearfea_worker manager` from the worker image, in a container of its own with the Docker socket. It claims jobs from the API in two **lanes**, solve (6 vCPU, 17 GB) and light (import, mesh and report; 1 vCPU, 4 GB), one job per lane, and runs each job in a fresh hardened container of the worker image (non-root, no capabilities, read-only root, its own scratch volume, memory without swap, a process limit). After its own restart it follows the job containers still running. The remaining 1 vCPU and about 3 GB stay with the system and Docker.
- **Check-ins** (M12.4, ADR-120): every 30 s the manager tells the API it is alive, with the host's load (CPU, memory, disk). The dashboard's Overview shows the host from these; if none comes for 2 minutes the host counts as offline.
- **Retries** (M12.2, ADR-122): a job lost to a machine fault (a container killed, the manager restarted, the VPS rebooted) is queued again, uncharged, at most twice. The manager stops taking jobs while the scratch disk has under 20 GiB free.
- **Statistics** (M12.3): each try's memory, CPU and disk, read on the dashboard's Jobs and runs tab.

The manager's settings are environment variables (`docs/ARCHITECTURE.md` section 7, "Compute manager"). On the VPS they will be, at least:

| Setting | Value on the VPS |
| --- | --- |
| `CLEARFEA_API_URL` | `https://clearfea.triyalabs.com` |
| `CLEARFEA_WORKER_TOKEN` | The `WORKER_TOKEN` secret (section 3) |
| `CLEARFEA_ACCESS_CLIENT_ID`, `CLEARFEA_ACCESS_CLIENT_SECRET` | The Access service token (section 1.8), so the manager gets past Cloudflare Access |
| `CLEARFEA_HOST_NAME` | A short name the dashboard shows for the host, for example `contabo-1` |
| `CLEARFEA_SOLVE_CPUSET`, `CLEARFEA_LIGHT_CPUSET` | `0-5` and `6`, so each lane keeps its own cores |
| `CLEARFEA_SCRATCH_PATH` or `CLEARFEA_HOST_DISK_PATH` | Docker's data directory on the VPS, so the 20 GiB stop and the dashboard's disk alert watch the right disk |

The environment template `infra/vps/manager.env.example` holds these (with `CLEARFEA_SCRATCH_PATH=/var/lib/docker`), the rest left at their defaults until M12.6 measures the VPS (M12.6 may change the lane sizes and the element limits).

### 4.3 Set the VPS up and redeploy it

Everything on the VPS comes from the folder `infra/vps/` (M12.5, ADR-110, ADR-131): a **bootstrap script** you run once, the **compute manager** as a systemd service that starts with the VPS and comes back by itself if it stops, an **image updater** that every 5 minutes loads the worker image the site names, and the **environment file** with the manager's settings. Nothing in it orders, replaces or restarts a VPS.

**How a new worker image reaches the VPS.** When a merge changes `worker/` or `packages/spec/`, the deploy's **Worker image** job builds the image and stores it as a compressed archive in the `clearfea-files` bucket (`worker-images/src-....tar.gz`, about a few GB; the newest three are kept), using the R2 keys of section 1.7, so nothing new goes into GitHub. The deployed site then names that image. Within 5 minutes the VPS's updater downloads and loads it, and every job after that runs it; a job already running finishes on the old one. The manager moves to the new image as soon as no job is running. A merge that changes neither folder builds nothing and the VPS keeps its image.

#### First setup (about 15 minutes)

You need: the VPS's IP address, your SSH key on it (4.1), and three secrets from your private note: `WORKER_TOKEN` (section 3) and the Access service token's **Client ID** and **Client Secret** (section 1.8). The site must have deployed once since M12.5 merged, so an image is stored (Actions tab, **Deploy**, a green run whose **Worker image** job says "Stored ...").

1. **Get the folder onto your computer.** On GitHub, open the repository, **Code** → **Download ZIP**, and unzip it. (With a clone, `git pull` instead.) The folder you need is `infra/vps` inside it.
2. **Copy it to the VPS.** In a terminal in the unzipped folder (PowerShell on Windows, Terminal on macOS):

   ```
   scp -r infra/vps root@<the VPS's IP>:clearfea-vps
   ```

   The first time, SSH asks whether to trust the VPS's key fingerprint: type `yes`.
3. **Log in and check the Ubuntu version.**

   ```
   ssh root@<the VPS's IP>
   cat /etc/os-release
   ```

   The `VERSION=` line must say 24.04 or 22.04. If it says anything else, reinstall the VPS with Ubuntu 24.04 in Contabo's control panel (it erases the VPS, which holds nothing you need yet), add your SSH key again, and start from step 2.
4. **Run the bootstrap script** (still logged in to the VPS):

   ```
   bash clearfea-vps/bootstrap.sh
   ```

   It updates the system (a few minutes), turns off password logins (SSH by key only, and only once your key is there), closes every port except SSH, installs Docker, and then asks for the three secrets one by one. Paste each and press Enter; nothing shows while you paste. It saves them in `/etc/clearfea/manager.env`, which only root can read. It then downloads the worker image (a few minutes) and starts the manager, and finally prints the manager's first log lines.
5. **Check it is up.** Within a minute the dashboard's **Overview** shows the host `contabo-1` online with its load, and the **Events** tab has a `host_online` event. Until M12.7 switches the site to the VPS (4.5) the live site sends it no jobs.

If step 4 stops with a message, it says what to do; fix that and run the same command again. Running it again is always safe.

#### Day to day on the VPS

All of these are typed on the VPS after `ssh root@<the VPS's IP>`:

| To | Type |
| --- | --- |
| See the manager's log, live (Ctrl-C to stop watching) | `journalctl -u clearfea-manager -f` |
| See what the image updater did | `journalctl -u clearfea-image-update -n 50` |
| Load a new image now instead of within 5 minutes | `systemctl start clearfea-image-update` |
| Restart the manager (running jobs keep going and are followed again) | `systemctl restart clearfea-manager` |
| Stop taking jobs until you start it again (running jobs keep going) | `systemctl disable --now clearfea-manager`, later `systemctl enable --now clearfea-manager` |
| See which image runs | `docker image ls clearfea-worker` (the `current` tag has the same IMAGE ID as the `src-...` it runs) |
| See running jobs | `docker ps` |

**Roll back the worker image.** Find the tag that worked: the `src-...` printed by the **Worker image** job of an earlier deploy run in the Actions tab (only the newest three are stored). On the VPS, `nano /etc/clearfea/manager.env`, set `CLEARFEA_IMAGE_PIN=src-...`, save (Ctrl-O, Enter, Ctrl-X), then `systemctl start clearfea-image-update`. The VPS keeps that image whatever later deploys store, until you empty the line again. Rolling back the site itself is section 7.2; it also rolls the image back when the older commit's archive is still stored.

**Change a secret** (after rotating `WORKER_TOKEN` in section 3, or making a new Access service token in 1.8): update GitHub first and let the deploy run, then on the VPS `nano /etc/clearfea/manager.env`, replace the value after `CLEARFEA_WORKER_TOKEN=`, `CLEARFEA_ACCESS_CLIENT_ID=` or `CLEARFEA_ACCESS_CLIENT_SECRET=` (no quotes, no spaces), save and `systemctl restart clearfea-manager`.

**Install an updated `infra/vps`** (when a pull request changes the scripts or the lane settings): steps 1, 2 and 4 again. The script keeps your environment file and its secrets; a changed setting in `manager.env.example` is not copied over it, so the pull request says which line to change by hand.

**Security updates** install themselves every day. The VPS never reboots by itself, since a reboot stops a running solve; when the login message says "System restart required", reboot when no job is running (`docker ps` shows only `clearfea-manager`) with `reboot`. The manager starts again with the VPS.

#### Rebuild on a reinstalled or new VPS

If the VPS is reinstalled from Contabo's panel, or you order a replacement by hand (4.1), do the first setup again: nothing on the VPS is of record. Keep the same `CLEARFEA_HOST_NAME` (`contabo-1`) so the dashboard keeps one host; jobs that were running on the old one are queued again by the site within a few minutes (4.4). If a new VPS has a new IP address, nothing on the site needs to change, since the site never calls the VPS.

### 4.4 When the VPS stops (restart it by hand)

When the solver host has not checked in for 2 minutes:

- The dashboard's **Overview** shows the alert "The solver host ... has not checked in ...", and the **Events** tab has a `host_offline` event (M13.1, M13.5). Alerts are on the dashboard only: nothing emails you and nothing restarts or replaces the VPS.
- New imports, meshes and runs are refused with a plain message (503) until the host is back. Jobs already queued wait in the queue. A job that was running when the host stopped is queued again by the site's per-minute check about 2 minutes after its last heartbeat, uncharged, at most twice (4.2, retries), and waits for the host too.

To bring it back:

1. Open <https://my.contabo.com>, find the VPS and use its **Restart** action (Contabo may call it reboot or power cycle). If the control panel shows it as running but it still does not check in, restart it anyway.
2. Within a few minutes of the VPS being up, the Overview shows the host online again and the Events tab has a `host_online` event: the manager starts with the VPS by itself (4.3).
3. If it does not come back, look at the VPS's console in Contabo's control panel, and tell a thread what the dashboard and the console show. A VPS that cannot be recovered is reinstalled or replaced by you, by hand, then set up again with 4.3.

### 4.5 Switch the site to the VPS (M12.7)

The live site still runs with `MACHINES=cloud` (`apps/api/scripts/productionConfig.mjs`), the AWS launcher's mode. With the AWS keys removed (5) and the stack deleted (7.6, done), a job queued there fails at once saying the solver machines are not set up, and nothing is charged. M12.7 changes production to `MACHINES=vps` once the VPS is set up and benchmarked (M12.6): from then on jobs wait for the VPS and runs show usage only (ADR-106 item 6). M12.7 runs the live checks (7.7) against it and updates this section.

## 5. GitHub: the full list

The repository's **Settings** → **Secrets and variables** → **Actions** should show:

| Name | Kind | From |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | 1.5 |
| `CLOUDFLARE_D1_DATABASE_ID` | Variable | 1.4 |
| `CLOUDFLARE_API_TOKEN` | Secret | 1.6 |
| `R2_ACCESS_KEY_ID` | Secret | 1.7 |
| `R2_SECRET_ACCESS_KEY` | Secret | 1.7 |
| `CF_ACCESS_CLIENT_ID` | Secret | 1.8 |
| `CF_ACCESS_CLIENT_SECRET` | Secret | 1.8 |
| `GOOGLE_CLIENT_ID` | Secret | 2.3 |
| `GOOGLE_CLIENT_SECRET` | Secret | 2.3 |
| `ADMIN_EMAIL` | Variable | 2.3 |
| `BETTER_AUTH_SECRET` | Secret | 3 |
| `WORKER_TOKEN` | Secret | 3 |
| `VERIFY_TOKEN` | Secret | 3 (optional, for the live checks) |

The worker image archive (4.3) needs nothing more: the deploy stores it with `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.

**Remove the AWS values.** `AWS_REGION` and `AWS_DEPLOY_ROLE_ARN` (variables) and `AWS_LAUNCHER_ACCESS_KEY_ID` and `AWS_LAUNCHER_SECRET_ACCESS_KEY` (secrets) belong to the AWS setup that is being deleted. Delete them on the same page (the bin icon beside each). The deploy still sends the launcher keys to the site whenever they are set, so removing them is what keeps a queued job from trying to start an AWS machine. A Worker keeps a secret it was once given even after GitHub stops sending it, so also open Cloudflare → **Compute (Workers)** → `clearfea` → **Settings** → **Variables and Secrets** and delete `AWS_LAUNCHER_ACCESS_KEY_ID`, `AWS_LAUNCHER_SECRET_ACCESS_KEY` and `AWS_REGION` there. Deleting the stack (7.6) also deletes the launcher user, so its key stops working in any case.

Optional: to approve each deploy yourself instead of letting every merge go live, go to **Settings** → **Environments** → `production` (created by the first deploy) → tick **Required reviewers** and add yourself. Deploys then wait for your click in the Actions tab for **Site and API**.

## 6. First deploy and inviting colleagues

### 6.1 Run the first deploy

1. GitHub → the repository → **Actions** → **Deploy** (in the list on the left) → **Run workflow** → branch `main` → **Run workflow**.
2. Click the run to watch it. It runs the tests first, then the **Site and API** job. Each step turns green. The **Check the deploy settings** step stops the run and names anything from section 5 that is missing. The last step checks that `https://clearfea.triyalabs.com/api/health` answers with the commit just deployed, through Cloudflare Access with the service token (1.8).
3. Open <https://clearfea.triyalabs.com>. The landing page appears; the first visit can take a minute while the certificate is issued.

After this, you never need to run it by hand: every merge to `main` runs it.

### 6.2 Sign in as admin

1. On the landing page, **Sign in with Google**, with your admin Gmail.
2. The bar along the bottom of the workbench shows **Admin** next to **Wallet**. Open it.

### 6.3 Invite a colleague

`ADMIN_GUIDE.md` section 1 has these steps with a message to send them.

1. Admin dashboard → **Users** → **Allowed addresses** → type the colleague's Gmail address → **Add**.
2. Check the same address is a **Test user** on the Google consent screen (2.2 step 7).
3. Send them the link `https://clearfea.triyalabs.com` and the user guide's tutorial. They sign in with Google; there is nothing to install.

To remove someone, select **Remove** next to their address on the dashboard's **Users** tab. They are signed out at once and cannot sign in again; their projects stay in the database. Adding the address again lets them back in to the same account.

If someone sees "This Google account is not invited", the address they chose on Google's screen is not on the list: check for a second Google account, or add the exact address they used.

## 7. Day to day

### 7.1 How a change goes live

1. A thread (or you) merges a pull request into `main`.
2. **Deploy** runs by itself: tests, then the database changes, the site and the API.
3. About 5 minutes later the site runs the new version. Your colleagues see it on their next page load.

If the tests fail, nothing is deployed and the site keeps the previous version. When a merge changes the worker, the deploy first stores a new worker image in R2 (its **Worker image** job, up to about 40 minutes when nothing is cached) and the VPS takes it between jobs (4.3).

### 7.2 Undo a bad deploy

GitHub → **Actions** → **Deploy** → **Run workflow**, and in **Use workflow from** pick the tag or branch of the last good version (a thread can make one for you). Data changes are not undone by this; to get data back, Cloudflare D1 → `clearfea` → **Time Travel** restores the database to any minute in the last 30 days.

### 7.3 Machine sizes

The large machine (8 vCPU, 32 GB) existed only on AWS and is off. On the VPS every run goes into the solve lane; the size a run chooses sets its estimate and rate, and the 16 GB element limits stay until M12.6 benchmarks the VPS. The dashboard's **Settings** tab → **Machine sizes** shows what runs may choose.

### 7.4 Check what it costs

- Contabo: the VPS is a fixed monthly price paid in advance; invoices are in <https://my.contabo.com>.
- Cloudflare → **Manage account** → **Billing**.
- ClearFEA dashboard → **Costs**: a month's jobs, machine time and usage by user and job type, beside the solver host's and Cloudflare's monthly cost. Those two amounts are settings (**Settings** → solver host and platform per month): set them to what you actually pay.

### 7.5 Check the solver host

Dashboard → **Overview**: the solver host with its latest CPU, memory and disk, each lane's running and waiting jobs, and the alerts (host offline, disk low, out of memory, repeated platform failures, queue paused). Each alert says what to do. The disk alert asks you to free space on the VPS. Log in (`ssh root@<the VPS's IP>`) and type `docker system df` to see what uses the disk, then `docker container prune -f && docker volume prune -f && docker image prune -f` (it removes only stopped containers, volumes no container uses and images without a tag, so a running job and its files are kept) and `journalctl --vacuum-size=500M`. If the disk is still full, tell a thread what `df -h /` and `docker system df` show.

### 7.6 Pause, delete AWS, shut down

- **Pause the solver**: dashboard → **Overview** → **Pause the queue**. No job starts; new jobs still queue and jobs already running finish; the site stays up. **Resume the queue** to start again.
- **Delete AWS (done 2026-10-23, ADR-106).** For the record, or if anything is left: in the AWS console, in the region the stack is in (`ap-south-1`):
  1. **Elastic Container Service** → **Clusters** → `clearfea` → **Tasks**: the list should be empty. Stop any task left.
  2. **ECR** → **Repositories** → `clearfea-worker` → select all images → **Delete**. The stack cannot delete a repository that still holds images.
  3. **CloudFormation** → `clearfea` → **Delete**. This removes everything the stack made: the network, the image store, the cluster and machine definitions, the log group, the `/clearfea/launch` setting, the budget alarm, the GitHub deploy role and the `clearfea-launcher` user with its key. Wait for **DELETE_COMPLETE**; if it fails, the **Events** tab names the resource that stopped it.
  4. **IAM** → **Identity providers**: if `token.actions.githubusercontent.com` is still listed and nothing else in the account uses it, delete it (the stack made it only when `CreateGitHubOidcProvider` was true).
  5. Remove the AWS values from GitHub and from the Worker (section 5).
  6. A few days later, **Billing and Cost Management** → **Bills** should show nothing new. To close the AWS account altogether: account name (top right) → **Account** → **Close account**.
- **Take the site down**: Cloudflare → **Compute (Workers)** → `clearfea` → **Settings** → **Domains & Routes** → remove `clearfea.triyalabs.com`.

### 7.7 Run the live checks

**Not before M12.7**: nothing on the live site takes a job until the VPS is live, so every case would fail.

GitHub → **Actions** → **Live checks** → **Run workflow**, and pick a suite: `quick` (the coarse verification tier, a few minutes of solver time), `acceptance` (cases A and B, the Phase 0 gate's item 1) or `limits` (a model at each solver's element limit, about four hours of solver time, gate item 4). The result table is on the run's summary page. They sign in as the verification account (`VERIFY_TOKEN`, section 3), get through Cloudflare Access with the service token (1.8), and the account is not an admin. It shows on the dashboard as "Verification account (live checks)". Nothing starts them on their own.

## 8. When something goes wrong

| What you see | Likely cause | What to do |
| --- | --- | --- |
| Deploy fails at "Check the deploy settings" | A secret or variable from section 5 is missing | The error names each missing one and its section; add it and run the deploy again (6.1) |
| Deploy fails at "Authenticate to Cloudflare" | `CLOUDFLARE_API_TOKEN` missing, mistyped or lacking a permission | Make a new token as in 1.6 and replace the secret |
| Deploy's last step says "Cloudflare Access refused the health check" | The Access policy or service token of 1.8 is missing or was copied wrongly | Check 1.8 steps 3 and 4 |
| Google says "Error 400: redirect_uri_mismatch" | The redirect URI in 2.3 differs from the site's | It must be exactly `https://clearfea.triyalabs.com/api/auth/callback/google` |
| Google says "Access blocked: ClearFEA has not completed the Google verification process" | The account is not a test user | Add it under Test users (2.2 step 7) |
| ClearFEA says the address is not invited | Not on the allowlist | Add it on the dashboard (6.3) |
| Imports, meshes and runs are refused saying the solver is offline | The VPS has not checked in for 2 minutes (only once the site runs `MACHINES=vps`, 4.5) | Restart the VPS by hand (4.4) |
| The Overview says the host's disk is low | Old images, stopped containers or raw output fill the VPS's disk | Free space on the VPS (7.5); at 20 GiB free the lanes stop taking jobs |
| The VPS's `journalctl -u clearfea-image-update` says no image to load, or the pinned image cannot be loaded | No deploy has stored an image since M12.5, or the pinned archive was pruned | Run **Deploy** by hand (6.1) and check its **Worker image** job; for a pin, choose one of the three newest tags (4.3) |
| The manager's log says the Docker image is not loaded, or `systemctl status clearfea-manager` keeps restarting | The image updater has not loaded an image yet | `systemctl start clearfea-image-update`, then read `journalctl -u clearfea-image-update -n 50` |
| The Overview reports tries out of memory | A model was too large for its lane | Look at the job's peak memory in **Jobs and runs** and tell a thread; the lane sizes and element limits are M12.6's |
| The Overview reports repeated platform failures | Something on the host or in ClearFEA keeps failing jobs | Read the `job_failed` and `job_retried` events and the jobs' logs on the dashboard; if the host is the cause, pause the queue and restart the VPS by hand (4.4) |
| A job fails saying the solver machines of this site are not set up | The site still runs the AWS mode (`MACHINES=cloud`) with no AWS key, as intended until M12.7 | Nothing to do: it is not charged. Jobs run again once M12.7 switches the site to the VPS |

## 9. This Claude project's environment

Claude never holds your Cloudflare, Contabo or Google keys: deploys happen in GitHub Actions, and the VPS is set up by you over SSH. One change lets threads check the live site after a deploy:

1. In the Claude project, open **Project settings** → **Cloud environment** → the gear beside the selected environment.
2. Under **Network access**, add `clearfea.triyalabs.com` to **Allowed domains**, keeping **Allow package managers** ticked. Save.

New threads pick it up. A thread can reach the site only through Access with the service token, given to it as the environment variables `CLEARFEA_ACCESS_CLIENT_ID` and `CLEARFEA_ACCESS_CLIENT_SECRET` (1.8).

## Appendix A. AWS, parked for production

The closed beta ran its solver on AWS Fargate from M10.7 until 2026-10-22 (ADR-099 to ADR-101). ADR-106 parks it: the launcher (`apps/api/src/launcher/`), the stack template (`infra/aws/clearfea.yaml`), the image script (`infra/aws/worker-image.sh`) and the **Machine logs** workflow stay in the repository, unused, for production later. Any code that starts AWS machines is reviewed by the maintainer before it is used again (ADR-106 item 4). The step-by-step AWS setup this guide used to hold (account, stack, launcher key, large machine, troubleshooting) is in this file's history, at commit `069785e` (`git show 069785e:docs/DEPLOYMENT.md`, sections 4 and 7 to 8); bring it back and review it when production is planned, rather than following it as it was.
