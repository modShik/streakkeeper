# StreakKeeper

Keeps your GitHub contribution streak alive automatically.

It runs quietly in the background on your own computer. Once an hour it
checks whether you've already got a contribution for today — if not, it
makes one. If your computer is off, or asleep, or you forgot it exists, it
picks up where it left off the moment you're back.

**One commit per day. Never two. Nothing to remember.**

---

## What you need

| | |
|---|---|
| **Node.js 18 or newer** | [Download here](https://nodejs.org) — the "LTS" version is right |
| **A GitHub account** | The one whose streak you want to keep |
| **5 minutes** | Genuinely — most of it is copy-paste |

Telegram is **optional**. StreakKeeper works fine without it; you just
won't get a message when something breaks.

---

## Setup

### Step 1 — Download it

```bash
git clone https://github.com/modShik/streakkeeper.git
cd streakkeeper
npm install
npm install -g pm2
```

> **What's PM2?** A small tool that keeps StreakKeeper running in the
> background and starts it again if your computer reboots. You install it
> once and never think about it again.

### Step 2 — Make a repository for your streak

StreakKeeper needs somewhere to commit. Make a **new, empty repository**
on GitHub just for this — don't use a real project.

1. Go to <https://github.com/new>
2. Name it something like `streak-log`
3. Choose **Public**
4. Tick **"Add a README file"**
5. Click **Create repository**

> **Why public?** Commits to private repositories only show on your
> contribution graph if you turn on "Private contributions" in your
> profile settings. Public is simpler and always works.

Copy that repository's URL — you'll need it in a moment. It looks like
`https://github.com/yourname/streak-log`

### Step 3 — Run the installer

```bash
node setup.js
```

It asks you a few questions and writes your settings for you. Below is
exactly what each answer needs to be.

---

## The two things you need to paste in

### 🔑 Your GitHub token — **required**

This is what lets StreakKeeper commit on your behalf. It is **not** your
password, and it can only touch the one repository you point it at.

1. Open <https://github.com/settings/personal-access-tokens/new>
2. Fill it in exactly like this:

   | Field | What to choose |
   |---|---|
   | **Token name** | `streakkeeper` |
   | **Expiration** | The longest you're comfortable with (90 days, 1 year, or No expiration) |
   | **Repository access** | **Only select repositories** → pick your `streak-log` repo |
   | **Permissions** | Expand **Repository permissions** → find **Contents** → set it to **Read and write** |

3. Leave everything else alone. **Contents is the only permission needed.**
4. Click **Generate token** at the bottom
5. Copy the token — it starts with `github_pat_` and you can only see it once

Paste that into the installer when it asks.

> ⚠️ **Treat this like a password.** Anyone with it can commit to that
> repository. Never post it, never commit it, never put it in a
> screenshot. If it leaks, delete it at
> <https://github.com/settings/tokens?type=beta> and make a new one.

### 💬 Telegram notifications — **optional, skip if unsure**

Turn this on if you want a message when a commit succeeds or something
breaks. You can always add it later.

**Get a bot token:**
1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Pick any display name, then a username ending in `bot`
4. BotFather sends back a token like `123456789:ABCdefGHI...` — copy it

**Get your chat ID:**
1. Search for **your own new bot** in Telegram and send it any message
   (Telegram bots aren't allowed to message you until you message them first)
2. Run:
   ```bash
   node manage.js telegram-id
   ```
3. It prints your chat ID — a plain number like `123456789`

> ⚠️ **Your chat ID is a NUMBER, not an @username.** Putting `@yourname`
> there is the single most common mistake — Telegram accepts it without
> complaint and then fails on every message forever. StreakKeeper now
> refuses to start if you do this, so you'll find out immediately.

---

## Step 4 — Start it, and keep it running

```bash
node manage.js check-auth    # confirms GitHub accepts your token
node manage.js start         # starts maintaining your streak
node manage.js autostart     # survives reboots  ← don't skip this
```

**That third command is the important one.** Without it, StreakKeeper
stops when your computer restarts and your streak quietly stops being
maintained — which is exactly the worry this project exists to remove.

`autostart` will print a command beginning with `sudo`. Copy it, run it
once, and you're finished forever.

<details>
<summary>Windows users — click here</summary>

PM2's `autostart` doesn't work on Windows. Install this instead:

```bash
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```
</details>

### Check it worked

```bash
node manage.js status
```

```
────────────────────────────────
StreakKeeper Status
────────────────────────────────
Repository        https://github.com/yourname/streak-log
GitHub token      Working
Telegram          Configured
Time zone         UTC
Today (UTC)       2026-08-02
Today completed   Yes
Last success      2026-08-02
Dry run mode      off
PM2 process       online
────────────────────────────────
```

If `GitHub token` says **Working** and `PM2 process` says **online**,
you're done. You never need to touch it again.

---

## Everyday commands

You will rarely need these, but here they are:

| Command | What it does |
|---|---|
| `node manage.js status` | Is everything healthy? |
| `node manage.js start` | Start it |
| `node manage.js stop` | Stop it |
| `node manage.js restart` | Restart it (after changing settings) |
| `node manage.js run-now` | Don't wait for the hourly check — go now |
| `node manage.js logs` | Watch what it's doing |
| `node manage.js check-auth` | Is my GitHub token still good? |
| `node manage.js telegram-id` | Find my Telegram chat ID |
| `node manage.js test-telegram` | Send a test notification |
| `node manage.js config` | Show my settings (passwords hidden) |
| `node manage.js autostart` | Set up restart-on-boot |

---

## When something goes wrong

**"GitHub token is missing, expired, or lacks access"**
Your token expired, or it wasn't given access to your streak repository.
Make a new one following Step 3, put it in `.env` as `GITHUB_TOKEN=`, then
`node manage.js restart`.

**Telegram messages never arrive**
Did you message your bot first? Bots can't start conversations. Then check
that `TELEGRAM_CHAT_ID` is a number, not an `@name`. Run
`node manage.js telegram-id` to get the right one.

**"The repository ... could not be found"**
Either the URL in `.env` is wrong, or your token wasn't granted access to
*that specific repository*. Fine-grained tokens only reach repositories you
explicitly selected when creating them.

**It says today is already done, but my graph looks empty**
GitHub's contribution graph can lag by a few minutes. Also check that the
commit is attributed to your account — open your streak repository and see
whether your avatar appears next to the latest commit.

**Nothing is happening at all**
```bash
node manage.js status     # is PM2 online?
node manage.js logs       # what is it actually saying?
```

---

## Settings

All settings live in a file called `.env`. `node setup.js` writes it for
you; you only need to open it if you want to change something later. After
any change, run `node manage.js restart`.

| Setting | What it's for | Default |
|---|---|---|
| `GITHUB_TOKEN` | Your token from Step 3. **Required.** | — |
| `GITHUB_REPOSITORY_URL` | Your streak repository. **Required.** | — |
| `GITHUB_BRANCH_NAME` | Branch to commit to | `main` |
| `STREAK_LOG_FILE_PATH` | File it writes to (created automatically) | `streak-log.md` |
| `TELEGRAM_BOT_TOKEN` | Optional — leave blank for no notifications | — |
| `TELEGRAM_CHAT_ID` | Optional — must be a number | — |
| `TIMEZONE` | Which timezone defines "today" (see below) | `UTC` |
| `GITHUB_COMMIT_AUTHOR_NAME` | Only needed if you change `TIMEZONE` | — |
| `GITHUB_COMMIT_AUTHOR_EMAIL` | Only needed if you change `TIMEZONE` | — |
| `RETRY_MAX_ATTEMPTS` | Tries before giving up for this hour | `5` |
| `RETRY_BASE_DELAY_MS` | How long to wait between tries | `30000` |
| `DRY_RUN` | Pretend to work without touching GitHub | `false` |
| `DEBUG` | Print a lot more detail | `false` |

<details>
<summary><strong>About TIMEZONE — worth reading if you're tempted to change it</strong></summary>

GitHub decides which day a commit belongs to using the commit's own
timestamp, and commits made through its API are stamped in **UTC**.

So StreakKeeper defaults to UTC too, which guarantees it and GitHub always
agree about which day a commit landed on. The only visible effect is that
your "day" rolls over at midnight UTC rather than local midnight.

If you set `TIMEZONE` to something else — say `Asia/Kolkata` — StreakKeeper
must stamp commits with that timezone's offset, and it can only do that if
you also set `GITHUB_COMMIT_AUTHOR_NAME` and `GITHUB_COMMIT_AUTHOR_EMAIL`.
It refuses to start otherwise, because the mismatch would silently file
commits on the day *before* the one it recorded — and you'd only notice
months later as a gap in your graph.

If you do set an author email, it **must be one verified on your GitHub
account**, or the commits won't count as contributions at all.
</details>

---

## How it works

```
Every hour:
  │
  ├─ Already have today's contribution?  ──yes──▶  do nothing, sleep
  │
  └─ no
       │
       ├─ read your streak file from GitHub
       ├─ already contains today?  ──yes──▶  do nothing, sleep
       ├─ append one line
       └─ commit it
```

It commits through GitHub's REST API — no browser, no automation of the
website, nothing that breaks when GitHub changes their design.

**It will not double-commit.** Two independent guards prevent it: a local
record of the last successful day, and a direct check of the file on GitHub
before writing. Even if you delete the local record, it won't commit twice.

<details>
<summary>Project layout, for the curious</summary>

```
streakkeeper/
├── main.js               Startup sequence
├── manage.js             All the commands above
├── setup.js              The installer
├── ecosystem.config.js   PM2 configuration
└── src/
    ├── config/           Settings, validated at startup
    ├── auth/             Token checking
    ├── engine/           Talks to GitHub
    ├── state/            "Did today already happen?"
    ├── notify/           Telegram
    ├── scheduler/        The hourly loop
    └── utils/            Logging, retries, dates
```

Each part only knows about the one below it. The scheduler doesn't know how
GitHub works, the engine doesn't know Telegram exists, and nothing outside
`src/config` reads environment variables directly.
</details>

---

## Is this safe?

**Your credentials never leave your computer.** There's no server, no
account to sign up for, no telemetry. StreakKeeper talks to GitHub and
(optionally) Telegram, and nothing else.

- The token you create can only touch **one repository** and can only
  **read and write file contents**. It cannot delete repositories, read
  your private code, or change your account.
- `.env` — the file holding your token — is git-ignored, so you can't
  accidentally commit it.
- `node manage.js config` hides your tokens, because that's the output
  people paste when asking for help.
- Nothing is ever written to the logs that would expose a credential.

**Is this against GitHub's rules?** StreakKeeper makes ordinary commits to
your own repository through the official API, at a rate of one per day. It
doesn't fabricate timestamps, inflate activity, or touch anyone else's
repositories.

That said, be honest with yourself about what a contribution graph means.
This keeps a streak alive; it doesn't make you a better engineer, and it
isn't a substitute for real work.

---

## Questions

**Does my computer need to be on all day?**
No. It checks hourly, so it only needs to be on for *some* part of the day.
If you miss a whole day entirely, that day is genuinely missed — nothing
can commit for you while the machine is off.

**Can I use my main repository instead of a new one?**
You can, but don't. A dedicated repository keeps automated noise out of
real project history.

**Will this spam my repository?**
One commit per day, one line each. About 8 KB a year.

**How do I turn it off?**
```bash
node manage.js stop
pm2 unstartup      # also stop it coming back after a reboot
```

**How do I move it to a new computer?**
Copy the folder (without `node_modules`), run `npm install`, and set up
your token again. Don't copy `.env` around — make a fresh token instead.

**Something's broken and I can't figure it out.**
Open an issue with the output of `node manage.js status` and
`node manage.js config`. Both hide your credentials, so they're safe to
paste.

---

## License

MIT — see [LICENSE](LICENSE). Do whatever you like with it.
