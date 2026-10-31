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
- State is in memory with a JSON snapshot on disk, and sessions use the in-memory `express-session` store. That's fine for a single-process demo, not for production.
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
