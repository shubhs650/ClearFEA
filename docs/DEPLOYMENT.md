# Deploying the live closed beta

How the maintainer sets up `clearfea.triyalabs.com` (ADR-095, milestone M10). Written for someone who is not a DevOps engineer: every step says where to click and what to copy where. You do these steps once. After that, every merge to `main` goes live by itself.

Self-hosting on your own machine is a different procedure: see `SELF_HOSTING.md`.

Once the site is up, running the beta day to day (inviting, removing, credits, machine sizes, costs, the tutorial trial) is in `ADMIN_GUIDE.md`.

> Status: written at the start of M10, before the code it describes is merged. Each section names the M10 task that needs it. Tasks update this file when they land, so check that the task is ticked in `PROGRESS.md` before doing its section.

## What you are setting up

| Piece | Service | What it does | Monthly cost (closed beta) |
| --- | --- | --- | --- |
| Website, API, sign-in | Cloudflare Workers (Paid plan) | Serves the landing page and the app at `clearfea.triyalabs.com`, runs the API | $5 |
| Database | Cloudflare D1 | Projects, simulations, runs, ledger, allowlist | Included |
| Files | Cloudflare R2 | STEP files, meshes, results, reports | Free up to 10 GB |
| Google sign-in | Google Cloud (OAuth client) | "Sign in with Google" | Free |
| Solver machines | AWS ECS Fargate | Starts a 4 vCPU / 16 GB machine when a job is waiting, stops it after 10 idle minutes | About $0.23 per machine hour, roughly $5 to $14 |
| Solver image store | AWS ECR | Holds the worker image | About $2 |
| Automatic deploys | GitHub Actions | Tests and deploys every merge to `main` | Free (public repository) |

All passwords and keys live in **one place: GitHub repository secrets**. The deploy workflow copies them to Cloudflare and AWS. Never paste a secret into a chat, an issue, a pull request or a file in the repository.

Two kinds of values go into GitHub:

- **Secrets** (hidden after saving): GitHub → the ClearFEA repository → **Settings** → **Secrets and variables** → **Actions** → **Secrets** tab → **New repository secret**.
- **Variables** (visible, not sensitive): same page, **Variables** tab → **New repository variable**.

Keep a private note (a password manager is best) of what you created, since some values are shown only once.

### Order

| Step | Needed by task | Section |
| --- | --- | --- |
| Cloudflare plan, R2, D1, tokens | M10.1, M10.2 | 1 |
| Google sign-in client | M10.3 | 2 |
| Two random keys | M10.3, M10.6 | 3 |
| R2 API token | M10.5 | 1.7 |
| AWS account and stack | M10.7 | 4 |
| GitHub secrets and variables | as each value is made | 5 |
| First deploy, invite colleagues | M10.2 onwards, M10.10 | 6 |

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

The API uses this to give a solver machine signed links to its files.

1. Left menu → **R2 Object Storage** → **Manage API tokens** (on the right of the R2 overview) → **Create API token**.
2. Name: `clearfea-presign`. Permissions: **Object Read & Write**. Specify bucket: **Apply to specific buckets only** → `clearfea-files`. TTL: Forever.
3. **Create API Token**. The next page shows an **Access Key ID** and a **Secret Access Key**, once.
4. In GitHub, add the **secrets** `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.

The deploy names the account and bucket for these links itself (from `CLOUDFLARE_ACCOUNT_ID` and the bucket in `wrangler.jsonc`). Until both secrets are set, solver machines move files through the API instead, which works only for files under 100 MB (ADR-098).

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
7. In GitHub, add the **variable** `ADMIN_EMAIL` with your admin Gmail address. That account is always allowed in and is the only one that sees the admin page.

Your colleagues' addresses do **not** go into GitHub. You add them on ClearFEA's admin page after the first deploy (section 6.3).

## 3. Two random keys (for tasks M10.3 and M10.6)

Make two long random strings. Either use your password manager's generator (40 or more characters, letters and digits), or run this in a terminal (Git Bash, WSL, macOS or Linux), once for each:

```
openssl rand -base64 32
```

| GitHub secret | What it is |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signs sign-in sessions. Changing it signs everyone out. |
| `WORKER_TOKEN` | The key solver machines use to talk to the API. The API hands it to each machine when it starts it, so it is never stored in AWS. |

## 4. AWS (for task M10.7)

The solver runs on AWS Fargate: a machine exists only while there is work, and you pay per second only while it exists. Everything ClearFEA needs in AWS is created in one go from a template file in the repository, `infra/aws/clearfea.yaml` (added by M10.7).

### 4.1 Create and protect the account

1. Go to <https://aws.amazon.com> → **Create an AWS Account**. Use an email you check; it becomes the root user. Choose the **Basic (free)** support plan.
2. Sign in as the root user → top right, your account name → **Security credentials** → **Assign MFA device** → follow the steps with an authenticator app. Do this before anything else.
3. Top right → account name → **Billing and Cost Management** → **Billing preferences**: turn on **Receive AWS Free Tier alerts** and **Receive CloudWatch billing alerts**, with your email.

### 4.2 Pick a region

Top right of the AWS console, next to your account name, is the region. Pick the one nearest you (for example **Asia Pacific (Mumbai) ap-south-1** in India, or **US East (N. Virginia) us-east-1**) and keep using it for every step. Prices differ by a few percent between regions; the site's speed for your colleagues does not depend on it.

In GitHub, add the **variable** `AWS_REGION` with the region code, for example `ap-south-1`.

### 4.3 Create the ClearFEA stack

Do this once the M10.7 pull request is merged.

1. Download `infra/aws/clearfea.yaml` from the repository on GitHub (open the file → **Download raw file**).
2. In the AWS console, search for **CloudFormation** → **Create stack** → **With new resources (standard)**.
3. **Choose an existing template** → **Upload a template file** → choose `clearfea.yaml` → **Next**.
4. Stack name: `clearfea`. Parameters:

   | Parameter | Value |
   | --- | --- |
   | `AlertEmail` | Your email, for cost alarms |
   | `MonthlyBudgetUsd` | The monthly AWS amount that should email you, for example `25` |
   | `GitHubRepository` | `shubhs650/ClearFEA` |
   | `ApiUrl` | `https://clearfea.triyalabs.com` |
   | `LargeSizeEnabled` | `false` (switch on later, section 7.3) |

5. **Next** → leave the options as they are → **Next** → at the bottom tick **I acknowledge that AWS CloudFormation might create IAM resources with custom names** → **Submit**.
6. Wait until the stack status reads **CREATE_COMPLETE** (a few minutes; press the refresh button).
7. Open the **Outputs** tab. In GitHub, add the **variable** `AWS_DEPLOY_ROLE_ARN` with the value of `DeployRoleArn`. You do not copy the other outputs: the stack also writes how to start a machine (cluster, subnets, security group) into a setting named `/clearfea/launch`, which the API reads by itself.

The budget alarm emails `AlertEmail` directly when the month's spending is forecast to pass 80% of `MonthlyBudgetUsd` and when it has passed it; there is no subscription to confirm.

If the stack fails with "Provider with url https://token.actions.githubusercontent.com already exists", the account already trusts GitHub from earlier work: create the stack again with `CreateGitHubOidcProvider` set to `false`.

What the stack creates: a small network with public subnets and no NAT gateway (which would cost about $32 a month on its own), the image store (ECR, keeps the last ten images), the ECS cluster, the machine definitions (standard 4 vCPU / 16 GB; large 8 vCPU / 32 GB only with `LargeSizeEnabled`), a log group kept for 14 days, the `/clearfea/launch` setting, the budget alarm, the role GitHub deploys with, and the `clearfea-launcher` user, which can only start those machine definitions and read that setting. Nothing in it costs money while no machine runs, apart from the stored images (about $0.10 per GB a month).

The first machine can start only once the deploy workflow has put the worker image in the image store. After adding `AWS_REGION` and `AWS_DEPLOY_ROLE_ARN`, run the deploy by hand once (6.1): its **Solver image** job builds the image (about half an hour the first time) and pushes it. Until then a job waits for about 20 minutes while three starts fail, then fails saying no machine came up; nothing is charged.

### 4.4 Create the launcher's access key

The API needs a key to start solver machines. The stack created a user that can do nothing else.

1. AWS console → search **IAM** → **Users** → `clearfea-launcher` → **Security credentials** tab → **Create access key**.
2. Use case: **Application running outside AWS** → **Next** → description `Cloudflare Worker` → **Create access key**.
3. Copy the **Access key** and the **Secret access key** (shown once).
4. In GitHub, add the **secrets** `AWS_LAUNCHER_ACCESS_KEY_ID` and `AWS_LAUNCHER_SECRET_ACCESS_KEY`.
5. Run the deploy once more (section 6.1) so the API gets the key. The admin page's **Solver machines** card then says machines start on AWS; before that it says they cannot be started yet and names what is missing.

## 5. GitHub: the full list

When all sections are done, the repository's **Settings** → **Secrets and variables** → **Actions** should show:

| Name | Kind | From |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | 1.5 |
| `CLOUDFLARE_D1_DATABASE_ID` | Variable | 1.4 |
| `CLOUDFLARE_API_TOKEN` | Secret | 1.6 |
| `R2_ACCESS_KEY_ID` | Secret | 1.7 |
| `R2_SECRET_ACCESS_KEY` | Secret | 1.7 |
| `GOOGLE_CLIENT_ID` | Secret | 2.3 |
| `GOOGLE_CLIENT_SECRET` | Secret | 2.3 |
| `ADMIN_EMAIL` | Variable | 2.3 |
| `BETTER_AUTH_SECRET` | Secret | 3 |
| `WORKER_TOKEN` | Secret | 3 |
| `AWS_REGION` | Variable | 4.2 |
| `AWS_DEPLOY_ROLE_ARN` | Variable | 4.3 |
| `AWS_LAUNCHER_ACCESS_KEY_ID` | Secret | 4.4 |
| `AWS_LAUNCHER_SECRET_ACCESS_KEY` | Secret | 4.4 |

Optional: to approve each deploy yourself instead of letting every merge go live, go to **Settings** → **Environments** → `production` (created by the first deploy) → tick **Required reviewers** and add yourself. Deploys then wait for your click in the Actions tab, once for the **Solver image** job and once for **Site and API**.

## 6. First deploy and inviting colleagues

### 6.1 Run the first deploy

1. GitHub → the repository → **Actions** → **Deploy** (in the list on the left) → **Run workflow** → branch `main` → **Run workflow**.
2. Click the run to watch it. It runs the tests first, then the **Solver image** job, then the **Site and API** job. Until AWS is set up (section 4), the **Solver image** job shows a warning naming `AWS_REGION` and `AWS_DEPLOY_ROLE_ARN` and builds nothing; the site still deploys. Each step turns green. The **Check the deploy settings** step stops the run and names anything from section 5 that is missing. The last step checks that `https://clearfea.triyalabs.com/api/health` answers with the commit just deployed.
3. Open <https://clearfea.triyalabs.com>. The landing page appears; the first visit can take a minute while the certificate is issued.

After this, you never need to run it by hand: every merge to `main` runs it.

### 6.2 Sign in as admin

1. On the landing page, **Sign in with Google**, with your admin Gmail.
2. The bar along the bottom of the workbench shows **Admin** next to **Wallet**. Open it.

### 6.3 Invite a colleague

`ADMIN_GUIDE.md` section 1 has these steps with a message to send them.

1. Admin page → **Allowed addresses** → type the colleague's Gmail address → **Add**.
2. Check the same address is a **Test user** on the Google consent screen (2.2 step 7).
3. Send them the link `https://clearfea.triyalabs.com` and the user guide's tutorial. They sign in with Google; there is nothing to install.

To remove someone, select **Remove** next to their address on the admin page. They are signed out at once and cannot sign in again; their projects stay in the database. Adding the address again lets them back in to the same account.

If someone sees "This Google account is not invited", the address they chose on Google's screen is not on the list: check for a second Google account, or add the exact address they used.

## 7. Day to day

### 7.1 How a change goes live

1. A thread (or you) merges a pull request into `main`.
2. **Deploy** runs by itself: tests, then the solver image if solver code changed, then the database changes, the site and the API.
3. About 5 minutes later the site runs the new version (20 to 30 minutes when the solver image is rebuilt). Your colleagues see it on their next page load. Jobs already running finish on the version they started with.

If the tests fail, nothing is deployed and the site keeps the previous version.

### 7.2 Undo a bad deploy

GitHub → **Actions** → **Deploy** → **Run workflow**, and in **Use workflow from** pick the tag or branch of the last good version (a thread can make one for you). Data changes are not undone by this; to get data back, Cloudflare D1 → `clearfea` → **Time Travel** restores the database to any minute in the last 30 days.

### 7.3 Switch on the large machine (8 vCPU / 32 GB)

1. AWS → **CloudFormation** → `clearfea` → **Update** → **Use existing template** → set `LargeSizeEnabled` to `true` → **Next** to the end → **Submit**.
2. ClearFEA admin page → **Machine sizes** → switch **Large** on.

Until the large machine is benchmarked it keeps the 16 GB element limits, so it does not yet allow bigger models (ADR-095 item 5).

### 7.4 Check what it costs

- AWS → **Billing and Cost Management** → **Bills** (this month so far) or **Cost Explorer** (by service: Fargate is "Elastic Container Service").
- Cloudflare → **Manage account** → **Billing**.
- ClearFEA admin page → **Solver machines**: machine hours used this month against the monthly limit, and the latest machines started with how each went.

### 7.5 Make sure nothing is left running

AWS → **Elastic Container Service** → **Clusters** → `clearfea` → **Tasks**. With no one working, the list is empty. A machine stops 10 minutes after its last job.

### 7.6 Pause or shut down

- **Pause the solver**: admin page → **Solver machines** → set the monthly limit to 0. No machine starts and new runs are refused; the site stays up. Set it back (for example to 60) to resume.
- **Shut AWS down completely**: CloudFormation → `clearfea` → **Delete**. The image store must be emptied first (ECR → `clearfea-worker` → select all images → **Delete**).
- **Take the site down**: Cloudflare → **Compute (Workers)** → `clearfea` → **Settings** → **Domains & Routes** → remove `clearfea.triyalabs.com`.

## 8. When something goes wrong

| What you see | Likely cause | What to do |
| --- | --- | --- |
| Deploy fails at "Check the deploy settings" | A secret or variable from section 5 is missing | The error names each missing one and its section; add it and run the deploy again (6.1) |
| Deploy fails at "Authenticate to Cloudflare" | `CLOUDFLARE_API_TOKEN` missing, mistyped or lacking a permission | Make a new token as in 1.6 and replace the secret |
| Deploy fails at "Configure AWS credentials" | `AWS_DEPLOY_ROLE_ARN` or `AWS_REGION` missing or wrong | Copy them again from 4.2 and 4.3 |
| Deploy fails at "Find the image store" or "Register the machine definitions" | The `clearfea` stack is missing, in another region than `AWS_REGION`, or older than the current `clearfea.yaml` | Create or update the stack (4.3) in that region and run the deploy again (6.1). Nothing of the site was deployed in that run |
| Google says "Error 400: redirect_uri_mismatch" | The redirect URI in 2.3 differs from the site's | It must be exactly `https://clearfea.triyalabs.com/api/auth/callback/google` |
| Google says "Access blocked: ClearFEA has not completed the Google verification process" | The account is not a test user | Add it under Test users (2.2 step 7) |
| ClearFEA says the address is not invited | Not on the allowlist | Add it on the admin page (6.3) |
| A job fails saying the solver machines of this site are not set up | The launcher key or `AWS_REGION` is missing | The admin page's **Solver machines** card names what is missing; add it (4.2, 4.4) and deploy again |
| A job fails saying 3 solver machines were started and none came up | AWS refused the starts, or the machines could not start | The admin page lists each start with AWS's reason. "AccessDenied": the key is not the `clearfea-launcher` one, or the stack is in another region than `AWS_REGION`. "ParameterNotFound": the stack is missing. A start that says nothing and never runs: the worker image is not in the image store yet (M10.8), or see the machine's log in AWS → CloudWatch → Log groups → `/clearfea/worker` |
| Runs are refused with "used its ... machine hours for this month" | The monthly limit was reached | Raise it on the admin page, or wait for the 1st |
| A cost alarm email | AWS spending passed `MonthlyBudgetUsd` | Check 7.5 for machines left running; tell a thread |

## 9. This Claude project's environment

Claude never holds your Cloudflare, AWS or Google keys: deploys happen in GitHub Actions. One change lets threads check the live site after a deploy:

1. In the Claude project, open **Project settings** → **Cloud environment** → the gear beside the selected environment.
2. Under **Network access**, add `clearfea.triyalabs.com` to **Allowed domains**, keeping **Allow package managers** ticked. Save.

New threads pick it up.
