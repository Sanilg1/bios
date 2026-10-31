# PRD — Responsible AI Access Gate

> **Team:** Netra · **Event:** [BIOS Hackathon](https://bios.notyouraverage.xyz), FORGE track (NamoID industry brief)
> **Status:** Draft v0.4 (adds mock H100 pool, college-cluster story, decision receipts, break-it panel, advisory confidence score), open for team review. Comment on the PR, edit this file, or bring it up at kickoff.
> **Challenge:** [`responsible-ai-access-gate`](https://github.com/namoidhq/namoid-challenges/blob/main/challenges/responsible-ai-access-gate.md) · **Repo:** https://github.com/Sanilg1/bios
> **Timebox:** 6 focused hours, then we stop.

---

## 1. Why we're building this

From the challenge brief: *Maya needs a sensitive fictional model for a two-week evaluation. Today, access arrives through a permanent API key with no clear purpose, reviewer, or end date.*

We're replacing that permanent key with a **purpose-bound, time-boxed, multi-reviewer grant**. The right people review it, it expires on its own, it can be revoked instantly, and every decision leaves an audit trail.

**One-line pitch:** *Maya gets a 7-day, evaluation-only, no-export mock key that three people signed off on and anyone on the risk side can kill instantly. Nobody gets a permanent key.*

**Where it goes next:** the same gate governs **H100 GPU time**, the scarcest and most consequential AI resource. We demo it with a mock H100 pool (§5) and name it as our first real resource (§15).

## 2. Goals and non-goals

### Goals
1. Four roles sign in through **NamoID Hosted Auth** as the app's sign-in system. It is not a social-login button. Our app handles the callback and creates its own session.
2. A requester asks for access to a **mock** model or dataset, stating purpose, duration and risk controls.
3. Required reviewers can **approve, narrow, or reject**.
4. Approved access **activates and expires automatically**.
5. Everyone can see **active grants** and an **append-only decision history**.
6. The server enforces these rules. The UI alone is not enough:
   - no self-approval (separation of duties)
   - no use outside the approved purpose
   - no silent extensions
   - no access after revocation

### Non-goals (safety boundaries, non-negotiable)
- ❌ No real production AI systems, no real credentials, no real or sensitive data. **Models, datasets, credentials and outputs are all mock.**
- ❌ We never say or imply that approval makes use *safe*. Approval means *authorized under stated conditions*, nothing more.
- ❌ We never commit `.env`, Client Secrets, authorization codes or tokens.
- ❌ No polish beyond what the demo needs. Correctness beats looks.

## 3. Users and roles

| Role | What they do | What they must never be able to do |
|---|---|---|
| **Requester** (e.g. Maya) | Creates requests, views own grants, "uses" a resource through the simulator | Approve or narrow their own request |
| **Manager** | Confirms the business need and can shorten duration | Review a request they submitted |
| **Risk Reviewer** | Checks purpose and controls, can add controls or narrow purpose, can **emergency-revoke** | Review a request they submitted |
| **Resource Owner** | Approves use of *their* resource, can narrow scope, can **emergency-revoke** grants on their resource | Review a request they submitted, or approve resources they don't own |

One person may hold several roles. **Separation of duties is enforced per request**: on any single request, one human (one NamoID `sub`) fills at most one slot.

**The same roles on a college GPU cluster** (our H100 story):

| Challenge role | College cluster equivalent |
|---|---|
| Requester | Student / researcher who needs GPU time |
| Manager | Faculty guide / PI who vouches for the project |
| Risk Reviewer | IT security or research-ethics reviewer |
| Resource Owner | HPC / lab admin who runs the cluster |

## 4. Architecture and constraints (from the template and the NamoID docs)

**What the template gives us:** a static `index.html` + `styles.css`, `npm run setup` / `npm run check` (the metadata validator, also run in CI), and a manual GitHub Pages deploy workflow. It has **no server, storage or test runner**, so we have to add those.

**What NamoID Hosted Auth is:** OpenID Connect Authorization Code with S256 PKCE. The docs recommend a **confidential web application** with a trusted backend, so that tokens never reach browser JS. The stable user key is the ID-token / UserInfo **`sub`**. Never join accounts by email.

**Proposed architecture** (to be confirmed as D7):

```
Browser (static UI, vanilla JS or React)
   │  HttpOnly session cookie only, no tokens
   ▼
Express server (Node 24)  ◀── adapted from namoidhq/namoid-examples/hosted-auth/express-react
   ├─ /api/auth/login, /callback, /logout   → NamoID Hosted Auth (OIDC + PKCE, confidential client)
   ├─ policy engine (pure functions + injectable clock)  ← all rules live here
   ├─ /api/requests, /reviews, /grants, /use, /revoke, /history
   └─ store: in-memory + JSON snapshot (or node:sqlite), seeded with mock resources
```

- **Policy engine = pure functions.** They take state and the clock and return a new state or a denial. This makes T1–T6 fast, deterministic unit tests with no network or NamoID needed.
- **Hosting:** GitHub Pages can't run Express. We deploy the server somewhere that can (Render / Railway / Fly free tier). The Pages site, if we keep it, just links to the demo. Whatever we choose, the deployed page must keep the template's "Powered by NamoID" footer and attribution.

## 5. Core concepts

```
Resource        mock model, dataset, or compute pool (id, name, type, owner_sub,
                allowed purposes, max_gpus for compute)
AccessRequest   requester_sub, resource, purpose(s), duration, controls, justification,
                gpu_count (compute only), status, extends_grant_id?
Review          one per required slot (manager | risk | owner): approve | narrow | reject
                + reason + reviewer_sub
Grant           final scope, purpose(s), controls, gpu_count, starts_at,
                expires_at (immutable), status, mock_credential
MockJob         compute only: grant, gpus, purpose, image, status
                (running | finished | killed | denied)
AuditEvent      append-only: actor_sub, action, target, before/after, timestamp, reason
```

### Mock resources (seed data)
- `model:sentinel-eval-mock` is the "sensitive fictional model" from Maya's story. It returns canned fake scores.
- `model:summarizer-mock` returns lorem-ipsum "summaries".
- `dataset:synthetic-support-tickets` holds 50 generated rows, each prefixed `SYNTHETIC`.
- `dataset:synthetic-claims-sample` holds generated rows labelled `SYNTHETIC`.
- `compute:h100-pool-mock` is a **fake** pool of 8× H100. Nothing is scheduled on real hardware. "Jobs" are records that pretend to run and show a fake progress bar.

### Purposes (enumerated, not free text, so they can be enforced)
`evaluation`, `internal-research`, `prototype-demo`, `fine-tuning`, `large-scale-training` (compute only, highest risk)

### Risk controls (selectable)
`no-export`, `rate-limit`, `output-watermark`, `logging-required`, `synthetic-inputs-only`
Compute-only: `no-network-egress`, `approved-images-only`

## 6. Lifecycle

```
draft ──submit──▶ in_review ──all 3 approve/narrow──▶ approved ──starts_at──▶ active ──expires_at──▶ expired
                      │                                                         │
                      └──any reject──▶ rejected                                └──revoke──▶ revoked
```

- **Any reject** rejects the whole request.
- **Narrowing** combines toward the most restrictive result: shortest duration, intersection of purposes, union of controls, and lowest GPU count.
- `active`/`expired` is **computed from the clock** on every read and every `/use` call. Expiry never depends on a background job having run.
- `revoked`, `expired` and `rejected` are terminal. A grant is never re-activated.

## 7. Functional requirements

Each FR has acceptance criteria (AC). The ACs are what we test.

### FR-1 Sign-in via NamoID Hosted Auth
- AC: We create a **confidential web application** in the NamoID Console (Test environment) and register the callback (e.g. `http://localhost:5174/api/auth/callback` locally, plus the deployed URL).
- AC: The server validates `state`, issuer, PKCE, the ID-token signature/aud/exp/nonce, and that the UserInfo `sub` matches. We use the NamoID SDK or an established OIDC library and don't hand-roll JWT checks.
- AC: The browser only ever holds an `HttpOnly` session cookie. Unauthenticated API calls get 401.
- AC: Roles come from an **app-side role table keyed by NamoID `sub`**, because the docs don't describe custom role claims. A dev-only admin page assigns roles to test accounts.
- AC: Logout clears the app session, revokes the grant via the discovered revocation endpoint, and optionally performs RP-initiated logout.
- AC: The demo has 4+ test accounts, at least one per role.

### FR-2 Create request
- AC: The requester picks a resource, one or more of *that resource's* allowed purposes, a duration (max 30 days, *D3*), controls, and a justification.
- AC: The API rejects purposes the resource doesn't allow, even if the UI is bypassed.
- AC: Compute requests also state a **GPU count** (1 up to the pool's `max_gpus`).

### FR-3 Review: approve / narrow / reject
- AC: Required slots are **manager + risk reviewer + resource owner**. *(D2)*
- AC: A reviewer acts only on a slot their role allows, only once, and the resource-owner slot only on resources they own.
- AC: Narrowing can only *reduce* scope (shorter duration, fewer purposes, more controls, fewer GPUs). The API rejects widening.
- AC: Every decision needs a reason and writes an AuditEvent.

### FR-4 Separation of duties
- AC: The requester can't review their own request in any slot, **even if they hold the role**. The API returns 403 and the attempt is logged as a denied event.
- AC: The same `sub` can't fill two reviewer slots on the same request.

### FR-5 Automatic activation and expiry
- AC: The grant becomes `active` at `starts_at` and `expired` at `expires_at` with no manual action.
- AC: `expires_at` is immutable after the grant is created.

### FR-6 Purpose-bound use simulator
- AC: Each grant gets a **mock credential** (`mock_key_…`, clearly fake). It replaces Maya's permanent API key.
- AC: `POST /api/use` with `{credential, resource, purpose, input}` returns a **mock output** only if the grant is active, belongs to the caller, matches the resource, and lists the purpose.
- AC: Every other case returns a clear denial reason (`expired`, `revoked`, `purpose_not_approved`, `not_yours`, `wrong_resource`). Both allows and denials are logged.
- AC: Every mock output carries a banner: *"Mock output. Authorization ≠ safety."*
- AC (compute): `POST /api/jobs` with `{credential, gpus, purpose, image}` starts a **mock job** only if the grant is active and the purpose is approved, `gpus` ≤ granted `gpu_count`, and the image is on the mock allowlist when `approved-images-only` is set. Other denial reasons: `gpu_count_exceeded`, `image_not_approved`.
- AC (compute): When the grant expires, its running mock jobs are marked `killed` on the next read. A job never outlives its grant.

### FR-7 No silent extensions
- AC: There is no "extend" button and no endpoint that edits `expires_at`.
- AC: More time means a **new request** linked to the previous grant (`extends_grant_id`), going through full review again. The UI shows the chain.

### FR-8 Emergency revocation
- AC: Risk reviewers and the resource owner can revoke an active grant immediately, with a required reason.
- AC: The next `/api/use` call is denied: no grace period, no cached allow.
- AC (compute): Revocation immediately marks every running mock job on that grant as `killed`.
- AC: The revocation shows up in active grants (removed) and history (recorded).
- Note: this revokes *our app's grant*. It's separate from NamoID session/token revocation (see §4), and the README will say so.

### FR-9 Visibility
- AC: **Active grants** view shows resource, holder, purposes, controls, and time remaining.
- AC: **Decision history** shows a filterable, append-only timeline per request and per resource, with denied attempts included.
- AC: History exports as JSON. The committed export is our **sample access history** (`samples/access-history.json`).

### FR-10 Decision receipts ⭐ signature feature
Every allow or deny, at review time and at use time, returns a plain-English **receipt** naming the rule that decided it.

**Rule catalogue** (shared by the receipts, the break-it panel, and the tests):

| Rule | Meaning |
|---|---|
| R0 | Must be signed in via NamoID Hosted Auth |
| R1 | You can't review your own request |
| R2 | One person, one slot per request |
| R3 | Narrowing can only reduce scope |
| R4 | Use must match an approved purpose |
| R5 | GPU count can't exceed the grant |
| R6 | Grant must be active (started and not expired) |
| R7 | Revoked grants never work again |
| R8 | Expiry is immutable, so more time needs a new request |
| R9 | Only the resource's owner fills the owner slot |
| R10 | Images must be on the allowlist when `approved-images-only` is set |
| R11 | This action needs the matching role *(added while building)* |
| R12 | Requests and decisions must be complete and within the resource's limits *(added while building)* |
| R13 | A grant only works for its holder and its resource *(added while building)* |

- AC: Every denial returns `{ allowed: false, rule: "R4", receipt: "Denied: your grant is approved for evaluation; this call was for internal-research." }`.
- AC: Every allow returns a receipt too, listing the grant, purposes, controls, expiry, and *"Authorized under these conditions. This does not mean the use is safe."*
- AC: Receipts are stored on the matching AuditEvent and shown in the history timeline.

### FR-11 "Try to break it" panel ⭐ signature feature
A page where judges (or teammates) attack the gate with one click per attack and watch each one get blocked.

- AC: Every attack calls the **same real API endpoints** the UI uses, with no special bypass, so the panel proves *server* enforcement.
- AC: Each attack card shows: what it tries, the HTTP request, the response, the rule (R-id) that stopped it, and the receipt.
- AC: Attacks: self-approve (R1), fill two slots (R2), widen while narrowing (R3), wrong purpose (R4), too many GPUs (R5), use after expiry (R6), use after revoke (R7), try to `PATCH expires_at` (R8), approve the owner slot as a non-owner (R9), call the API with no session (R0).
- AC: Time-travel for the expiry attack uses a **demo-only clock control**, enabled by `DEMO_MODE=true`, logged as an AuditEvent, and disclosed in the README.
- AC: Each attack maps one-to-one to an automated test (§8), so the panel and the test suite tell the same story.

### FR-12 Requester confidence score (advisory only)
A track-record score, like a credit score built **only from behaviour inside this app**, shown to reviewers as context.

- **Advisory only.** It **never** approves, rejects, narrows, or changes who must review. All three human reviewers are still required (D2, D9).
- **Inputs** (all in-app behaviour, never identity):

  | Signal | Effect (starting weights, tunable) |
  |---|---|
  | Grant ended cleanly (expired with no violations) | +5 |
  | Accurate request: used ≥ 50% of approved GPU-hours (compute) | +3 |
  | Over-asked: used < 20% of approved GPU-hours (compute) | −3 |
  | Denied use attempt (wrong purpose, too many GPUs, ...) | −3 each |
  | Grant emergency-revoked | −20 |

- **New users start neutral** at 50, labelled *"No history yet"* so reviewers don't read it as bad. The score is clamped to 0–100.
- AC: The review screen shows the score **with its contributing events** (e.g. "+5 grant #12 ended cleanly"), never a bare number.
- AC: Requesters can see their own score and its reasons.
- AC: The score is never computed from name, email, department, year, or any NamoID profile attribute.
- AC: The UI label reads: *"Advisory. Based only on your history in this app. Reviewers decide."*

## 8. Required tests (submission-critical)

Runner: Node's built-in `node:test` (zero dependencies, `npm test`). All tests use the injectable clock.

| # | Test | Must prove |
|---|---|---|
| T1 | Separation of duties | Requester reviewing own request → denied. Same `sub` in two slots → denied. |
| T2 | Expiry | Advance clock past `expires_at` → status `expired`, `/use` denied |
| T3 | Narrowed scope | Narrowed purpose/duration/GPUs → grant reflects it. Use with the removed purpose is denied, and a job above the narrowed GPU count is denied. |
| T4 | Emergency revocation | Revoke → immediate `/use` denial, running mock jobs `killed`, audit event present |
| T5 | No silent extension | No path mutates `expires_at`. An extension request needs full review. |
| T6 | Purpose enforcement | Active grant, wrong purpose → denied |
| T7 | Auth boundary | API without session → 401 (integration test, NamoID mocked) |
| T8 | Receipts | Every denial in T1–T7 carries the expected rule id (R0–R10) and a non-empty receipt |
| T9 | Score stays advisory | Changing a requester's score from 0 to 100 never changes required slots, decisions, or grant scope. A new user starts at 50 with "No history yet". |
| T10 | Break-it parity | Every attack in the panel has a matching test that asserts the same rule id |

**Proof that the tests bite:** before submitting, remove each rule's check one at a time, confirm at least one test fails, then restore it. Record the results in `DECISIONS.md` → Testing.

## 9. UX and copy principles
- Persistent banner: **"All models, datasets, credentials, and outputs are mock. Approval authorizes use under stated conditions; it does not make use safe."**
- Denials explain *why* in plain language, through the receipts (FR-10).
- Reviewers see the requester's identity, justification, and advisory confidence score with its reasons, plus a diff when they narrow.
- Keep the template's header and footer attribution ("Powered by NamoID · Independent community build").

## 10. Submission checklist (from challenge + template)
- [ ] `npm run setup -- --challenge=responsible-ai-access-gate ...` run, and `npm run check` passing (CI runs it on every push)
- [ ] NamoID Console confidential web app created, Hosted Auth wired end to end
- [ ] **Both** a live demo URL (judges can try the break-it panel) **and** a ~3-min screen recording as the safe bet (script in §12)
- [ ] `npm test` green for T1–T10, and the "tests bite" check recorded
- [ ] `samples/access-history.json` committed
- [ ] `README.md` sections filled: NamoID integration (client type, issuer/env, callback path, session, user journey), What works, Known limitations, AI and external resources, time spent
- [ ] `DECISIONS.md` filled: scope, architecture, security/privacy, testing, "with another hour"
- [ ] "First real resource this could govern" (§15) in README
- [ ] Push, copy the full 40-char SHA (`git rev-parse HEAD`), and submit via the [community build form](https://github.com/namoidhq/namoid-challenges/issues/new?template=community-build.yml)

---

## 11. Team plan: everyone owns something

Team Netra is **4 people with all-round skills** (frontend/React, backend/Node, security/auth, design/storytelling), so there's one owner per lane. Nobody is "just helping": each owner makes the calls in their area, **owns one signature piece**, and demos it at the end. Claim a lane by putting your name in the table (edit the file or comment on the PR).

| Workstream | Core scope | ⭐ Signature piece | Owner | Buddy / reviewer |
|---|---|---|---|---|
| **A. Auth and security** | NamoID Console app, Express + Hosted Auth (adapt the official example), session, role table, test accounts, logout | **Break-it panel** attacks (FR-11): thinking like an attacker | _claim me_ | |
| **B. Policy engine and API** | Pure-function state machine, SoD, narrowing, clock, mock credentials, mock jobs, revocation, `/use`, audit log, store | **Rule catalogue + receipts engine** (FR-10) and **confidence score** logic (FR-12) | _claim me_ | |
| **C. UI (React)** | Request form, reviewer queue with narrow diff, active grants, H100 job view, history timeline, safety banner, template attribution | **Break-it panel UI**, receipt cards, score-with-reasons display | _claim me_ | |
| **D. Tests, story and ship** | T1–T10, "tests bite" check, seed data, history export, README/DECISIONS, hosting, recording | **College-cluster story**: 10-min chat with the cluster admin, one real quote, the demo video and pitch | _claim me_ | |

Best guess at a natural fit: security person → A, backend → B, frontend → C, design/storytelling → D. Swap freely.

**Interfaces to agree on at kickoff** (so lanes don't block each other):
- B publishes the API contract (routes and JSON shapes) in `docs/api.md` within the first hour. C builds against stub data until it lands.
- A exposes `requireUser(req) → { sub, name, roles[] }` middleware that B's routes use.
- B's policy module has no Express or NamoID imports, so D can test it from minute one.

### Working agreements
- Branch per workstream (`feat/auth`, `feat/policy`, `feat/ui`, `test/core`) and small PRs. **Every PR gets one review from someone outside that lane**, so everyone ends up understanding the whole system.
- 5-minute check-in at each phase boundary below: what's done, what's blocked, what's next.
- Disagreements go in §13 as a decision. The owner of that area decides, and we move on.
- Nobody pastes the Client Secret in chat or commits it. Share it via `.env` only.
- Everyone presents their own piece in the demo.

## 12. Six-hour timeline

| Time | Phase | Output |
|---|---|---|
| 0:00–0:30 | **Kickoff (everyone)** | Claim workstreams, settle §13 decisions, run `npm run setup`, create Console app, agree on API shape |
| 0:30–2:30 | **Build core** | Hosted Auth login works locally. Policy engine, SoD and rule catalogue in code. Request + review screens. T1 green. *D: cluster-admin chat happens in this window.* |
| 2:30 | ✅ Check-in | End-to-end: request → 3 reviews → grant, with receipts |
| 2:30–4:30 | **Enforcement and signature** | Expiry, narrowing, revocation, `/use` + mock jobs, history view, break-it panel, confidence score. T2–T10 green. |
| 4:30 | ✅ Check-in | Feature freeze. Only fixes after this. |
| 4:30–5:30 | **Harden, deploy and record** | Deploy, seed demo data, export sample history, record demo |
| 5:30–6:00 | **Wrap (everyone)** | README, DECISIONS, "first real resource", pin SHA, submit. **Stop.** |

**Demo script (~3 min), following Maya's story:**
0. **Hook (D, 15s):** the real quote from our cluster admin about shared logins and unfair booking.
1. Maya signs in via NamoID Hosted Auth → requests `sentinel-eval-mock` for `evaluation` + `internal-research`, 14 days
2. Maya tries to approve her own request → ❌ receipt: *R1, you can't review your own request*
3. Reviewers see Maya's advisory score (*50, no history yet*). Manager (faculty guide) approves. Risk narrows to 7 days, `evaluation` only, adds `no-export`. Owner approves.
4. Maya uses the mock key for `evaluation` → ✅ mock output + receipt *"authorized under these conditions; not a safety guarantee"*
5. Maya uses it for `internal-research` → ❌ R4
6. Fast-forward the clock 8 days → ❌ R6 expired. There's no extend button, only a new request.
7. **H100 scene:** a student requests 8 mock H100s for 7 days for `fine-tuning`. Risk narrows it to 2 GPUs for 3 days with `no-network-egress`. A 4-GPU job → ❌ R5. A 2-GPU job starts (fake progress bar).
8. Risk reviewer hits **emergency revoke** → the running job flips to `killed`, the next job ❌ R7, and the student's score drops with the reason shown
9. **Break-it panel:** click through all ten attacks, every one blocked with its rule id
10. History timeline with receipts → JSON export

## 13. Decisions (✅ = settled, rest are a team vote at kickoff)

| ID | Question | Proposal | Decided |
|---|---|---|---|
| D1 | Where do roles live? | App-side table keyed by NamoID `sub`. The docs don't describe custom role claims, so A should double-check in the Console. | |
| D2 | Are all 3 reviewer slots always required? | Yes, always. No fast path in MVP. | ✅ All 3 always |
| D3 | Max grant duration? | 30 days | |
| D4 | After narrowing, must the requester accept before activation? | No for MVP (narrowed grant activates, requester notified). Stretch: accept step. | |
| D5 | Storage? | In-memory + JSON snapshot (simplest). `node:sqlite` if someone wants it. | |
| D6 | Who can emergency-revoke? | Risk reviewer + resource owner | |
| D7 | Stack and hosting? | Express (from the official NamoID example) + static UI, hosted on Render/Railway/Fly. Pages links to it. | |
| D8 | UI: vanilla JS or React? | React (team strength, and the official example is Express + React) | ✅ React |
| D9 | What can the confidence score do? | Advise reviewers only. Never routes, approves, or narrows. Neutral start at 50. | ✅ Advisory only |
| D10 | Demo format? | Live link + 3-min recording | ✅ Both |
| D11 | Signature features? | Decision receipts + break-it panel | ✅ Both |

## 14. Stretch goals (only if T1–T10 are green)
- Risk tiers based on the **request** (resource sensitivity, GPU count, purpose, duration), never on the person's score. Low-risk requests could skip the manager slot. Good material for "with another hour".
- Requester "accept narrowed terms" step
- `rate-limit` control actually enforced in `/use`
- GPU-hours budget meter per grant (used vs approved)
- Revocation webhook to a mock downstream system

## 15. First real resource this could govern

**Proposal: H100 GPU time on our college / lab GPU cluster.** Final wording to be agreed by the team at 5:30, after D's chat with the cluster admin.

**The pain today** (from the team, to be confirmed with the admin):
- **Shared logins.** One account or password is passed around a group, so nobody knows who ran what.
- **No fair booking.** It's first-come-first-served or "whoever knows the admin", with no time limits.

Our gate answers both. Every person signs in as themselves via NamoID, so the shared login is gone. Every GPU hour is requested, reviewed, time-boxed and capped, so there's a fair booking with automatic expiry.

**Why H100s first**
- They're scarce and expensive, and informal access means no purpose, no end date, and jobs that quietly hog GPUs.
- Compute is how capable models get made. Policymakers already use training compute as a signal of risk, so purpose-bound, time-boxed GPU access is a meaningful control point.
- Our model maps one-to-one: purpose, duration, GPU count, controls, and kill switch.

**What changes from mock to real**
| Mock (this POC) | Real |
|---|---|
| `compute:h100-pool-mock`, fake jobs | Gate issues scheduler reservations / quotas (e.g. Slurm reservations and QoS, Kubernetes ResourceQuota) for exactly the approved GPUs and window |
| `mock_key_…` | Short-lived scheduler credentials or account bindings, issued per grant |
| Revoke → job marked `killed` | Revoke → scheduler cancels the jobs and drops the reservation |
| In-memory store | Durable store, admin audit export, incident runbook behind "emergency revoke" |

**Honest limitation (and why approval ≠ safety):** for a model, every call states its purpose. For a GPU, **we can't verify what a job actually does**. A job approved for `evaluation` could secretly be training. Controls like approved images, no network egress, and GPU caps *reduce* that risk but don't eliminate it. Approval authorizes access; it doesn't prove safe use.

*Fallback candidate if the team prefers:* a shared LLM API key for a student project or lab (Maya's problem in real life).

---

*Contributors: add your name here when you edit or review this doc.*
