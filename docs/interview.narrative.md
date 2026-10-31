# Team Netra — Interview Narrative

**Responsible AI Access Gate** · BIOS Hackathon, FORGE track · NamoID brief `responsible-ai-access-gate`

> How we tell the story, how every line of the problem statement maps to what we built, and how we answer the hard questions.
> Speakers: **A** = auth & security, **B** = policy engine, **C** = UI, **D** = story & ship. Each person presents their own piece.

---

## 1. The 20-second version

> Access to powerful AI shouldn't come from a permanent key someone pasted in a chat.
> We built a gate where every request states **what** you need, **why**, and **for how long**. Three people sign off, the access expires on its own, works only for the approved purpose, and can be killed in one click. Every decision comes with a receipt.
> And approval is never the same as safety. We say that on every screen.

---

## 2. The story

### Act 1: Maya, from the brief *(D tells this)*

Maya needs a sensitive model for a two-week evaluation. Today she'd get a **permanent API key**:

- nobody asked *why*
- nobody really *approved* it
- it *never expires*
- it works for *anything*
- if something goes wrong, there's *no off-switch* and *no record*

It's the office master key handed out because someone needed the meeting room once.

### Act 2: Kabir, from our own campus *(D tells this)*

Kabir is a final-year student. He needs H100 GPUs for a fine-tuning project. On our college cluster today:

- the group **shares one login**, so nobody knows who ran which job
- booking is **first-come-first-served**, or "whoever knows the admin", with no time limit

> *"[Real quote from our cluster admin goes here]"*

Maya's problem and Kabir's problem are the **same problem**: access to a powerful AI resource with no purpose, no reviewer, and no end date.

### Act 3: The gate *(live demo, everyone)*

**Maya's path**
1. Maya signs in through **NamoID Hosted Auth** as herself. There are no shared accounts. *(A)*
2. She requests `sentinel-eval-mock` for **evaluation + internal research, 14 days**. *(C)*
3. She tries to approve her own request. **Blocked**, with the receipt: *"R1: you can't review your own request."* *(B)*
4. The reviewers see her advisory confidence score: *"50, no history yet"*. Her faculty guide approves. The risk reviewer **narrows** the request to **7 days, evaluation only, no export**. The resource owner approves. *(C)*
5. She uses her temporary mock key for evaluation. ✅ It works, and the receipt says: *"Authorized under these conditions. This does not mean the use is safe."* *(B)*
6. She tries internal research. ❌ *R4: purpose not approved.*
7. We jump the clock forward 8 days. ❌ *R6: expired.* There is no "extend" button. More time means a new request and a full review.

**Kabir's path (mock H100 pool)**
8. Kabir asks for **8 H100s for 7 days**. Risk narrows it to **2 GPUs, 3 days, no internet access**. *(C)*
9. He submits a 4-GPU job. ❌ *R5.* He submits a 2-GPU job, and it runs (fake progress bar).
10. The risk reviewer hits **emergency revoke**. The running job is **killed instantly**, the next job is refused, and his score drops with the reason shown. *(B)*

**Then we hand the judges the attack panel**
11. **"Try to break it."** Ten one-click attacks. Every one is blocked by the server, and each shows the rule it hit. *(A)*
12. The history timeline, with a receipt on every decision, exported as our sample access history. *(D)*

### Act 4: What's next *(D)*

The first real thing we'd govern: **H100 time on our college cluster**. Same roles, same rules. The gate would issue real scheduler bookings instead of mock jobs. We also tell you upfront what we *can't* verify (§6).

---

## 3. Problem statement → how we solve it

| Problem statement says | What we built | Where | How we prove it |
|---|---|---|---|
| *"Start with the official template"* | Repo created from the NamoID template, `npm run setup` run for Team Netra, `npm run check` passes in CI | repo root | CI badge / `npm run check` |
| *"Use NamoID Hosted Auth as the application's sign-in system. Not social login."* | Confidential web app. Express server runs OIDC + PKCE, validates tokens, creates its own `HttpOnly` session. The browser never sees a token. Users are keyed by NamoID `sub`, never by email. | FR-1 | T7: no session → 401. Live sign-in in the demo. |
| *"Requester, manager, risk reviewer, and resource owner authenticate"* | Four roles in an app-side role table keyed by `sub`, with test accounts for each. Also mapped to a college: student, faculty guide, IT/ethics, HPC admin. | FR-1, §3 | Demo with 4 accounts |
| *"A request identifies a mock model or dataset, purpose, duration, and risk controls"* | Request form with an enumerated purpose list, max 30 days, and selectable controls. The **mock H100 pool** adds a GPU count. | FR-2 | API rejects purposes the resource doesn't allow |
| *"Required reviewers can approve, narrow, or reject"* | Three required slots. Any reject rejects the request. Narrowing can **only shrink** scope (time, purposes, GPUs) or add controls. | FR-3 | T3 narrowed scope · break-it: "widen while narrowing" (R3) |
| *"Approved access activates and expires automatically"* | Status is **computed from the clock** on every read and use, so it doesn't depend on a background job. Expiry is immutable. | FR-5 | T2 expiry |
| *"Show active grants and decision history"* | Active-grants view with time remaining. Append-only timeline with a **receipt** on every allow and deny. JSON export. | FR-9, FR-10 | `samples/access-history.json` |
| *"Prevent self-approval"* | Separation of duties per request: the requester can't fill any slot, even if they hold the role, and one person fills one slot. | FR-4 | T1 · break-it R1, R2 |
| *"Prevent use outside the approved-purpose simulation"* | Every use names a purpose, and the server checks it against the grant. GPU jobs are also capped by the granted GPU count. | FR-6 | T6 · T3 · break-it R4, R5 |
| *"Prevent silent extensions"* | There is no extend button and no endpoint that edits expiry. An extension is a **new linked request** with a full review. | FR-7 | T5 · break-it R8 |
| *"Prevent access after revocation"* | Emergency revoke is immediate, needs a reason, and kills running mock jobs. Revoked grants never come back. | FR-8 | T4 · break-it R7 |
| *"Use mock models, datasets, credentials, and outputs"* | Everything is fake: `*-mock` models, `SYNTHETIC` datasets, `mock_key_…` credentials, fake H100 jobs | §5 | Banner on every screen |
| *"Do not imply that approval makes use safe"* | Built into the product: every allow receipt says *"authorized, not safe"*, and we openly state what we can't verify | FR-10, §6 below | Visible in demo |
| *"Tests: separation of duties, expiry, narrowed scope, emergency revocation"* | T1–T10 using Node's built-in runner and an injectable clock. **We broke each rule on purpose and confirmed a test caught it.** | §8 | `npm test` · DECISIONS.md |
| *"Demo or recording"* | Both: a live link (judges try the break-it panel) and a 3-min recording | D10 | Links in README |
| *"Sample access history"* | Exported timeline with receipts | FR-9 | `samples/access-history.json` |
| *"Stop after six hours and identify the first real resource"* | We stopped at six hours. First resource: **H100 time on our college cluster**, with a mock-to-real plan. | §15 | README |

---

## 4. What we added beyond the brief, and why

| Addition | Why it matters |
|---|---|
| **Decision receipts** | Every yes or no explains itself and cites a rule. Nobody is left wondering *"why was I denied?"*, and auditors get the *why*, not just the *what*. |
| **"Try to break it" panel** | Most teams *claim* their rules work. We let judges attack ours. It hits the real API with no bypass, and each attack matches an automated test. |
| **Mock H100 pool** | Shows the gate works beyond models and datasets, for the scarcest AI resource there is. Adds GPU-count narrowing and a live job kill. |
| **Advisory confidence score** | Gives reviewers context from past behaviour, with guardrails (§5). |

---

## 5. The confidence score: built responsibly

This is a responsible-AI challenge, so we treated our own scoring feature as something that needs governing too.

| Risk with a credit-style score | Our guardrail |
|---|---|
| A score quietly replacing human judgement | **Advisory only.** It never approves, rejects, narrows, or skips a reviewer. A test proves a score of 0 or 100 changes nothing. |
| A black-box number | Always shown **with its reasons**, e.g. *"+5 grant #12 ended cleanly"* |
| Punishing newcomers | New users start **neutral at 50**, labelled *"No history yet"* |
| Bias from identity data | Built **only** from in-app behaviour, never name, email, department, year, or profile data |
| Being judged in secret | Requesters can see their own score and why |

---

## 6. What we're honest about

- **Approval ≠ safety.** The gate controls *access*, not *outcomes*.
- **We can't verify what a GPU job actually does.** A job approved for "evaluation" could secretly be training. Approved images, no internet access, and GPU caps *reduce* that risk but don't remove it.
- **Revoking a grant is not revoking a NamoID session.** They're separate layers, and the README explains both.
- **Demo-only time travel.** The clock control used to show expiry exists only in demo mode, and every use is logged.
- **Mock to real needs real work:** a credential broker, scheduler integration, durable storage, and an incident process behind "emergency revoke."
- **We stopped at six hours.** What's missing is listed under Known limitations.

---

## 7. Likely judge questions

**"Isn't this just an approval workflow?"**
An approval workflow records that someone said yes. Our gate **enforces** what they said yes *to*: purpose, time, GPU count, and revocation are checked by the server on every use. The break-it panel shows it.

**"Why is NamoID essential here, not decoration?"**
Separation of duties only works if you know *who* someone really is. Shared logins are half of our campus problem. NamoID gives every person their own verified identity (`sub`), and every rule, receipt, and score is tied to it. Without real identity, "you can't approve your own request" is meaningless.

**"What stops a reviewer from just approving everything?"**
Three independent reviewers, any one of whom can reject. Narrowing is easy and visible. Every decision needs a reason and is permanently in the history. We don't pretend to fix human judgement; we make it visible and accountable.

**"Why not let high-scoring users skip review?"**
We considered it and said no. The brief requires reviewers, and letting a score override people is exactly the kind of automated decision a responsible-AI system should avoid. With another hour, we'd tier by the *request's* risk (GPU count, purpose), never by the person.

**"How do you know your tests actually work?"**
We removed each rule's check one at a time and confirmed a test failed every time. Results are in DECISIONS.md.

**"What happens at 23:59:59 on the expiry day?"**
Status is computed from the clock on every call, so at `expires_at` the next call is denied. There's no cron job to miss. A test covers that exact boundary.

**"How would this work on a real cluster?"**
Approval would create a scheduler booking (for example a Slurm reservation) for exactly the approved GPUs and time window. Revoke would cancel the jobs and drop the booking. The roles map directly: student, faculty guide, IT/ethics, HPC admin.

**"What was hardest?"**
*(Each speaker answers for their lane, one honest sentence each.)*

---

## 8. Closing line

> We didn't build a way to say *yes*. We built a way to say *yes, but only this much, only for this, only until then*, and to make that stick.
