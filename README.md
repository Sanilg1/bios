# Responsible AI Access Gate

**[Powered by NamoID](https://namoid.in)** ·
[NamoID documentation](https://docs.namoid.in) ·
[Challenge catalog](https://challenges.namoid.in)

> Built on the NamoID identity platform for the **NamoID Community Challenges** program.

This repository is a contributor-owned response to the
`responsible-ai-access-gate` problem statement. It was created from the official
[NamoID challenge template](https://github.com/namoidhq/namoid-challenge-template).

This project is an independent community build. It is not an official
NamoID product, security recommendation, or endorsement.

**No permanent keys.** People ask for a *mock* model, dataset or H100 GPU time with a purpose, a duration and risk controls. A manager, a risk reviewer and the resource owner each approve, narrow or reject. Access activates and expires on its own, works only for the approved purpose, and can be killed instantly. Every decision gets a plain-English receipt.

> All models, datasets, credentials, GPUs and outputs are **mock**. Approval authorizes use under stated conditions; it does **not** make use safe.

Docs: [PRD](docs/PRD.md) · [Interview narrative](docs/interview.narrative.md) · [API](docs/api.md) · [Decisions](DECISIONS.md) · [Sample access history](samples/access-history.json) · [Do the tests bite?](samples/mutation-report.md)

## Problem statement → how we solve it

Each line of the [challenge](https://github.com/namoidhq/namoid-challenges/blob/main/challenges/responsible-ai-access-gate.md), what we built for it, and how you can check it. Rule IDs (R0–R13) are the ones printed on every decision receipt; tests T1–T10 are in [test/](test/).

### What to build

| The problem statement asks for | How we solve it | Where | Proof |
|---|---|---|---|
| Start from the official template | Created from the NamoID template; `npm run setup` run for Team Netra; attribution kept in this README, [namoid-challenge.json](namoid-challenge.json) and the landing page | repo root | `npm run check` |
| NamoID Hosted Auth as the sign-in system, not social login | Confidential web app: the Express server runs OIDC Authorization Code + S256 PKCE with `@namoidhq/js`, validates the ID token and UserInfo `sub`, then issues its own `HttpOnly` session. Tokens never reach the browser. Every user is keyed by NamoID `sub`, never email. | [server/auth/namoid.js](server/auth/namoid.js) | T7: no session → 401 (R0) · break-it "no session" |
| Requester, manager, risk reviewer and resource owner authenticate | All four sign in through NamoID; roles are an app-side table keyed by `sub`. Mapped to a college: student, faculty guide, IT/ethics, HPC admin. | [server/policy/catalog.js](server/policy/catalog.js), [engine.js](server/policy/engine.js) | Four personas in local dev |
| A request names a mock model or dataset, a purpose, a duration and risk controls | Request form with purposes from a fixed list (each resource allows only some), duration ≤ 30 days, controls, and a justification. We added a **mock H100 pool**, which also takes a GPU count. | [RequestView.jsx](client/src/views/RequestView.jsx), `createRequest` in [engine.js](server/policy/engine.js) | Purpose not allowed / too long → R12 |
| Required reviewers can approve, narrow or reject | Three required slots: manager, risk reviewer, resource owner. Any reject ends the request. Narrowing can only **shrink** scope (purposes, days, GPUs) or **add** controls. Every decision needs a reason. | [ReviewView.jsx](client/src/views/ReviewView.jsx), `review` in [engine.js](server/policy/engine.js) | T3 · break-it "widen while narrowing" (R3) |
| Approved access activates and expires automatically | The grant is issued the moment the last slot approves. Status (`active` / `expired` / `revoked`) is **computed from the clock** on every read and use, so there's no cron job to miss. | `grantStatus` in [engine.js](server/policy/engine.js) | T2: active at `expiresAt − 1ms`, expired at `expiresAt` |
| Show active grants and decision history | Grants view with time remaining and mock jobs; an append-only history of every allow **and** deny, each with a plain-English receipt, filterable and exportable as JSON | [GrantsView.jsx](client/src/views/GrantsView.jsx), [HistoryView.jsx](client/src/views/HistoryView.jsx) | [samples/access-history.json](samples/access-history.json) · T8 |

### What to prevent

| The problem statement says prevent | How we stop it | Rule | Proof |
|---|---|---|---|
| Self-approval | The requester can't fill **any** slot on their own request, even if they hold every role. One person fills one slot. The owner slot needs the resource's actual owner. | R1, R2, R9 | T1 · break-it "self-approve", "two slots", "non-owner approves" |
| Use outside the approved purpose | Every use names a purpose and a mock credential; the server checks holder, resource and purpose against the grant. H100 jobs are also capped at the granted GPU count and an approved-image list. | R4, R5, R10, R13 | T6 · T3 · break-it "wrong purpose", "too many GPUs" |
| Silent extensions | Expiry is a non-writable property. No endpoint can change it; `PATCH`/`PUT`/`extend` always refuse and are logged. More time means a **new linked request** with a full review. | R8 | T5 · break-it "silent extension" |
| Access after revocation | Emergency revoke (risk reviewer or owner, with a reason) takes effect on the next call, kills running mock jobs, and can't be undone. | R7 | T4 · break-it "after revoke" |
| Access after expiry | Expired grants are refused for use and new jobs; running jobs die with the grant. | R6 | T2 · break-it "after expiry" |

### Safety boundaries

| The problem statement says | How we follow it |
|---|---|
| Use mock models, datasets, credentials and outputs | Everything is fake: `*-mock` models, `SYNTHETIC` datasets, `mock_key_…` credentials, simulated H100 jobs. A mock banner is on every screen. |
| Don't imply that approval makes use safe | Every allow receipt ends with *"Authorized under these conditions. This does not mean the use is safe."* (T8). [First real resource](#first-real-resource-this-could-govern) states what we can't verify. |
| Never commit secrets, codes or tokens | Client Secret and session secret live only in `.env`, which is git-ignored. Credentials are never written to the audit log (T8). |

### What to submit

| The problem statement asks for | Where it is |
|---|---|
| Public repo | This repository |
| Demo or recording | Live demo and recording: links in [Community project metadata](#community-project-metadata) |
| Tests for separation of duties, expiry, narrowed scope and emergency revocation | T1, T2, T3 and T4 in [test/engine.test.js](test/engine.test.js); 40 tests in total (`npm test`). [scripts/mutation-check.mjs](scripts/mutation-check.mjs) removes each rule in turn and confirms a test fails: [report](samples/mutation-report.md). |
| Sample access history | [samples/access-history.json](samples/access-history.json) (`npm run sample-history`) |
| Stop after six hours and name the first real resource | [H100 GPU time on our college cluster](#first-real-resource-this-could-govern) |

### What we added beyond the brief

- **Decision receipts:** every allow and deny explains itself and names its rule.
- **"Try to break it" panel:** ten one-click attacks against a fresh sandbox copy of the real app. The same list runs as test T10, so the panel and the tests can't disagree.
- **Mock H100 pool:** GPU-count narrowing and live job kill on revoke.
- **Advisory confidence score:** starts neutral at 50, built only from in-app behaviour, always shown with its reasons. It **never** changes who reviews or what is granted (T9).

## NamoID integration

NamoID Hosted Auth is the application's only production sign-in system ([server/auth/namoid.js](server/auth/namoid.js), adapted from the official [Express + React example](https://github.com/namoidhq/namoid-examples/tree/main/hosted-auth/express-react) and using [`@namoidhq/js`](https://www.npmjs.com/package/@namoidhq/js)).

- **Client type:** confidential web application (Client ID + server-only Client Secret + S256 PKCE). The Express server is the trusted backend.
- **Issuer / environment:** resolved by the SDK from the Client ID through OIDC discovery. Nothing is hard-coded. Use a Test environment app for the demo.
- **Callback path:** `<APP_BASE_URL>/api/auth/callback`. Register that exact URL in the Console (locally `http://localhost:5174/api/auth/callback`).
- **Callback validation:** one-time transaction (`state`, `nonce`, PKCE verifier, 10-minute expiry), authorization-response issuer, code exchange, ID-token signature/issuer/audience/expiry/nonce via `validateOIDCIdToken`, and UserInfo `sub` must equal the ID-token `sub`.
- **Application session:** the session is regenerated after sign-in. The browser only gets an opaque `HttpOnly`, `SameSite=Lax` cookie (`Secure` over HTTPS). NamoID tokens stay server-side, and access tokens are refreshed from the server-held refresh token before expiry. A failed refresh ends the session.
- **Identity key:** the NamoID `sub`. Every rule (no self-approval, one person per slot, only the holder can use a grant), every audit event and the confidence score are keyed by `sub`, never by email.
- **Roles:** app-side, keyed by `sub`. NamoID's docs don't describe custom role claims. In demo mode a signed-in user can pick their own demo roles (audited). Separation of duties still applies per request, so even a user holding every role can't approve their own request.
- **Sign-out:** clears the app session, revokes the refresh token at NamoID's revocation endpoint, and redirects through NamoID's end-session endpoint.
- **User journey:** "Sign in with NamoID" → NamoID Hosted Auth → callback → gate dashboard → request / review / use / revoke → sign out.
- **Grant revocation ≠ NamoID revocation.** Emergency revoke kills an *access grant* inside this app. It doesn't end anyone's NamoID session; those are separate layers.

No credentials, authorization codes or tokens are committed. See [.env.example](.env.example).

## Community project metadata

- **Challenge ID:** `responsible-ai-access-gate`
- **Contributor:** Team Netra
- **Live demo:** Add URL
- **Final commit:** Add the full 40-character SHA at submission time
- **Time spent:** Add estimate
- **License:** MIT

## Start here

1. Create your repository using **[Use this template](https://github.com/namoidhq/namoid-challenge-template/generate)**.
2. In the new repository, run:

```bash
npm run setup -- --challenge=responsible-ai-access-gate --name="Your Name" --title="Your Project" --repo=https://github.com/you/project
npm run check
```

Replace `responsible-ai-access-gate` with the ID shown in the selected problem statement.
Setup removes
the remaining template placeholders and records machine-readable attribution in
[`namoid-challenge.json`](./namoid-challenge.json).

3. [Create an application in the NamoID Console](https://console.namoid.in/login).
4. Configure its callback URL and integrate NamoID Hosted Auth into your POC.
5. Build, test, deploy, and submit the pinned commit.

## Run locally

Requires Node 24.

```bash
npm install
cp .env.example .env      # fill in NAMOID_CLIENT_ID / NAMOID_CLIENT_SECRET / SESSION_SECRET
npm run dev               # Express API on :4000 + Vite on :5174
```

Open `http://localhost:5174`. Before the NamoID Console app exists, set `DEV_LOGIN=true` in `.env` to sign in as fictional personas (Maya, Kabir, the faculty guide, the risk reviewer, the HPC admin). Dev login is refused when `NODE_ENV=production`.

```bash
npm test                  # T1–T10 (node:test, injectable clock, no network)
node scripts/mutation-check.mjs   # removes each rule in turn and checks a test fails
npm run sample-history    # regenerates samples/access-history.json from the demo story
npm run build && NODE_ENV=production npm start   # one process serves API + built UI
```

`npm run landing` still serves the template's static landing page (`index.html`) on :8080.

## Deploy (Vercel + Railway)

```
Browser ──▶ Vercel (React UI, static)  ── /api/* rewrite ──▶  Railway (Express API + gate state)
```

Vercel serves the built UI and forwards every `/api/*` request to Railway ([vercel.json](vercel.json)). The browser only ever talks to the Vercel domain, so the session cookie is first-party and the NamoID callback lives on the Vercel URL. The API runs on Railway rather than as a Vercel function because the gate keeps sessions and state in one long-running process.

1. **Push** this repo to GitHub.
2. **Pick the Vercel domain:** `vercel link`, then create a project (e.g. `netra-gate` → `https://netra-gate.vercel.app`).
3. **Railway:** New project → Deploy from GitHub repo → this repo. [railway.json](railway.json) sets `npm start` and the `/api/health` health check. Under *Variables*, set:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `APP_BASE_URL` | the Vercel URL from step 2, no trailing slash |
   | `SESSION_SECRET` | 48+ random characters |
   | `NAMOID_CLIENT_ID` / `NAMOID_CLIENT_SECRET` | from the NamoID Console |
   | `DEMO_MODE` | `true` (judges can pick roles and move the demo clock; both audited) |
   | `TRUST_PROXY` | `2` (Vercel and Railway's edge) |

   Then *Settings → Networking → Generate Domain*. Production refuses to start without the NamoID and session variables, and refuses `DEV_LOGIN`.
4. **Point Vercel at Railway:** replace `RAILWAY_HOST` in [vercel.json](vercel.json) with the Railway domain (e.g. `bios-production.up.railway.app`), commit, then `vercel --prod`.
5. **NamoID Console:** add the callback `https://<vercel-domain>/api/auth/callback`, and the Vercel URL as the post-logout redirect if the Console asks.
6. **Check:** `curl https://<vercel-domain>/api/health` → `{"status":"ok"}`, then sign in through NamoID.

Railway's disk resets on every redeploy, which clears requests, grants and history. To keep them, attach a Railway volume at `/app/data`.

## What works

- **Sign-in** through NamoID Hosted Auth (server-side OIDC + PKCE), with the session, refresh and logout flows from the official example.
- **Requests:** a mock model, dataset or **mock H100 pool**, with enumerated purposes, a duration (≤ 30 days), risk controls, a GPU count for compute, and a justification.
- **Review** by three required slots (manager, risk reviewer, resource owner). Any reject ends the request. **Narrowing** can only shrink scope (purposes, days, GPUs) or add controls, and every decision needs a reason.
- **Separation of duties:** you can't review your own request (even holding every role), one person fills one slot, and the owner slot needs the resource's actual owner.
- **Automatic activation and expiry:** status is computed from the clock on every read and use, so there's no cron job to miss. Expiry is immutable.
- **Purpose-bound use simulator:** a per-grant `mock_key_…` credential works only for its holder, resource and approved purposes. Mock H100 jobs are also capped by GPU count and the image allowlist, and die with their grant.
- **No silent extensions:** no endpoint can change expiry (attempts are logged as R8). More time is a new linked request with a full review, starting when the old grant ends.
- **Emergency revocation** by the risk reviewer or resource owner, with a reason. It's immediate, kills running mock jobs, and is terminal.
- **Active grants + decision history:** an append-only audit log of every allow *and* deny, each with a **decision receipt** naming its rule (R0–R13). Exportable as JSON.
- **Try to break it:** ten one-click attacks run against a fresh sandbox copy of the app (same routes, same engine) and show the rule that blocked each.
- **Advisory confidence score:** built only from in-app behaviour, shown with its reasons, and starts neutral at 50 ("No history yet"). It **never** changes who reviews or what is granted, and a test proves it.
- **Tests:** 40 tests covering T1–T10, including separation of duties, expiry, narrowed scope and emergency revocation. A mutation check shows every rule is guarded by at least one failing test.

## First real resource this could govern

**H100 GPU time on our college / lab cluster.** Today, access often comes through a shared login passed around a group, with first-come-first-served booking and no time limits. The same four roles map directly: student (requester), faculty guide (manager), IT security or ethics (risk reviewer), and HPC admin (resource owner). In a real deployment, approval would create a scheduler booking (e.g. a Slurm reservation) for exactly the approved GPUs and window, and revoke would cancel the jobs. **Honest limit:** we can't verify what a GPU job actually does. Approved images, no network egress and GPU caps reduce misuse but don't prove safe use.

## Known limitations

- The NamoID Hosted Auth flow is implemented against the official SDK and example, and the SDK reaches NamoID's servers. It still needs a real Console Client ID to complete an end-to-end sign-in; that is the first thing to configure.
- Roles in demo mode are self-assigned (audited). Production would need an admin-managed role table.
- State is in memory with a JSON snapshot on disk, and sessions use the in-memory `express-session` store. That's fine for a single-process demo, not for production. It's also why the API runs as one Railway process, not as Vercel functions.
- The demo clock control exists only with `DEMO_MODE=true` and logs every jump.
- Purpose enforcement is a simulation. Callers *declare* a purpose; a real system would need technical controls behind that declaration.
- The mock-to-real path (credential broker, scheduler integration, incident process) is designed, not built.

## AI and external resources

- Built with AI assistance (Anthropic's Claude, via Claude Code) for planning, the PRD, code and tests, reviewed and directed by Team Netra.
- NamoID auth flow adapted from [namoidhq/namoid-examples · hosted-auth/express-react](https://github.com/namoidhq/namoid-examples/tree/main/hosted-auth/express-react) and the [NamoID docs](https://docs.namoid.in).
- Libraries: `@namoidhq/js`, Express, express-session, express-rate-limit, helmet, React, Vite.

## NamoID attribution

Keep the factual challenge attribution in this README,
`namoid-challenge.json`, and the deployed page. You may change the surrounding
design and implementation. Attribution must not imply that NamoID authored,
audited, or endorses your solution.

## Submit to the catalog

Commit and push the exact version you want reviewed, then copy its full SHA:

```bash
git push
git rev-parse HEAD
```

Open the [Submit a community build](https://github.com/namoidhq/namoid-challenges/issues/new?template=community-build.yml)
form and paste the 40-character SHA into **Pinned commit SHA**. This identifies
one immutable version even if you continue changing the repository later. You
can request a catalog update or removal later.
