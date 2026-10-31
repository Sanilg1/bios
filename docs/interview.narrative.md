# Interview narrative: Team Netra

> **Responsible AI Access Gate** for the NamoID FORGE brief (`responsible-ai-access-gate`).
> Live: https://netra-gate.vercel.app · Repo: https://github.com/Sanilg1/bios · Slides: the "Netra: Responsible AI Access Gate" deck.
>
> Speakers: **A** = auth & security, **B** = policy engine, **C** = UI and dashboards, **D** = story and shipping. Each person presents their own piece. Put names here: A [name], B [name], C [name], D [name].

---

## 1. The story (60 seconds, D)

**Maya, from the brief.** Maya needs a sensitive model for two weeks of evaluation. Today she'd get a permanent API key. The project ends; the key keeps working. Nobody wrote down why she had it, and nobody remembers to take it back.

**Kabir, from our campus.** Kabir is a final-year student who needs H100 GPUs for his thesis. On our campus, GPU time runs on shared logins and first-come booking. Nobody knows who ran what, or for how long.

**What we built.** A gate with **no permanent keys**. You ask for exactly what you need, in your own words, for a set time. Three different people review it. The access starts and ends on its own, works only for what was approved, and can be stopped in one click. Every yes and every no comes with a receipt.

---

## 2. The brief, and how we solve it

| The brief says | What we built | Where to see it |
|---|---|---|
| Start from the official template | Repo created from the NamoID template; `npm run check` passes | repo root |
| NamoID Hosted Auth as the sign-in, not social login | Server-side OIDC + S256 PKCE with `@namoidhq/js`; ID token and UserInfo `sub` checked; the browser only gets an HttpOnly cookie | Sign in on the live site |
| Requester, manager, risk reviewer and owner authenticate | All four sign in through NamoID. Everyone is a requester; reviewer roles come from the operator's role directory, matched on a NamoID-verified email. Nobody can pick their own role | Four test accounts, one per role |
| A request names a mock model or dataset, purpose, duration and risk controls | Mock models, synthetic datasets and a mock H100 pool. **Purposes are free text** in the requester's own words (up to 3), plus days and controls | My access → Request access |
| Reviewers can approve, narrow or reject | Three required slots; any reject ends it; narrowing can only shrink (R3); every decision needs a reason | Manager, Risk reviewer, Resource owner dashboards |
| Access activates and expires automatically | Status computed from the clock on every call; expiry can't be edited | My access → My access table |
| Show active grants and decision history | Each person's dashboards plus an append-only history with a receipt on every decision, scoped to what you may see | History tab, Export JSON |
| Prevent self-approval | R1 (even holding every role), R2 (one person, one slot) | Step 3 of the demo |
| Prevent use outside the approved purpose | R4 (purpose must match an approved one), R5 (GPU cap), R10 (approved images) | Step 6 of the demo |
| Prevent silent extensions | R8: no way to edit expiry; more time = new request with full review | "Need more time?" button |
| Prevent access after revocation | R7: instant, kills running jobs, permanent | Step 7 of the demo |
| Mock everything; don't imply approval = safe | Everything is fake; every approval receipt says "This does not mean the use is safe" | Banner on every screen |
| Tests: separation of duties, expiry, narrowed scope, emergency revocation | T1–T4 of 63 tests; a mutation check proves all 18 protections are tested; `npm run e2e:demo` runs the whole flow with four real NamoID test users | `npm test` |
| Sample access history | `samples/access-history.json` | repo |
| Stop after six hours; name the first real resource | H100 time on our college cluster | Section 5 |

---

## 3. What only we built

| Addition | Why it matters |
|---|---|
| **Try to break it** | Judges attack the real app: ten one-click attacks against a fresh copy, each blocked with its rule. The same list runs as tests. |
| **Independent dashboards, enforced by the server** | Each role sees its own dashboard; a requester can't see anyone else's requests, grants, jobs or history, because the server filters every list. |
| **Mock H100 pool** | The scarcest AI resource: GPU-count narrowing, approved images only, and revoke kills running jobs. |
| **Confidence score** | Credit-style context for reviewers, always with its reasons, and a test proves it can never decide. |
| **Free-text purposes, still enforced** | Fits real requests, yet use must name an approved purpose exactly (case and spacing ignored). |
| **Receipts** | Every allow and denial explains itself and names its rule. |
| **Tests that bite** | We removed each protection on purpose and checked a test failed: 18 out of 18. |

### Score guardrails

| Risk with a credit-style score | Our guardrail |
|---|---|
| Replacing human judgement | **Advisory only.** It never approves, rejects, narrows or skips a reviewer. A test proves a low and a high score get identical reviews and grants. |
| A black-box number | Always shown **with its reasons**, e.g. "−20 grant_4 was emergency-revoked" |
| Punishing newcomers | Starts **neutral at 50**, labelled "No history yet" |
| Bias from identity data | Built **only** from behaviour in the app: never name, email or department |
| Being judged in secret | Everyone sees their own score and why, on My access |

Inputs: +2 approved exactly as asked, +5 grant ended cleanly, +3 / −3 for using or wasting approved GPU-hours, −3 per refused use, −20 per emergency revocation.

---

## 4. The demo workflow

### Before you present (10 minutes before)

1. **Wake the server.** Open https://netra-gate.vercel.app once. Render's free tier sleeps; the first load can take about 30 seconds, and waking resets the data to the sample story.
2. **Get fresh codes.** NamoID Console → bios hackathon → **Test** → Users → Test users → key icon, for each of the four accounts. Codes last one hour.
3. **Open four browser windows**, each in its own profile or incognito window, and sign each account in **once**. Stay signed in: NamoID pauses sign-ins after too many attempts from one network.

| Window | Account | Role |
|---|---|---|
| 1 | `requester+namoid_test_ew4pufuu@test.namoid.in` | Requester |
| 2 | `manager+namoid_test_zedaguvc@test.namoid.in` | Manager |
| 3 | `risk.reviewer+namoid_test_649shn79@test.namoid.in` | Risk reviewer |
| 4 | `res.owner+namoid_test_4ya965sp@test.namoid.in` | Resource owner and admin |

4. Check each window shows the right tabs: requester sees **My access**, **History** and **Try to break it**; each reviewer also sees **their own** dashboard tab; the owner also sees **Admin**.

### The three minutes

| # | Who | Window | Click | What to say |
|---|---|---|---|---|
| 1 | A | Requester | Already signed in: point at "signed in through NamoID", the profile and the score | "NamoID Hosted Auth is the only way in. Everyone is their NamoID ID." |
| 2 | C | Requester | My access → Resource **Sentinel**. Purpose: "Evaluate refusal behaviour on synthetic prompts". 7 days, tick **no-export**, add a reason → **Submit for review** | "Purpose in your own words. The receipt shows it needs all three reviewers." |
| 3 | B | Requester | Show the request in **My requests**: three slots waiting. (Optional: the History tab shows the attempt log.) Then open **Try to break it → Approve your own request** | "You can't review your own request, even holding every role: R1." |
| 4 | C | Manager | **Manager** tab → the new card → reason → **Approve** | "Each reviewer has their own dashboard. The receipt stays on screen." |
| 5 | C | Risk | **Risk reviewer** tab → the card → **Narrow…** → 7 → 3 days → reason → **Confirm narrow** | "Risk can only shrink scope, never widen it: R3." |
| 6 | C | Owner | **Resource owner** tab → the card → reason → **Approve** | "All three decided: the grant is issued and starts now." |
| 7 | B | Requester | My access → the use console → pick the approved purpose → **Call mock resource**. Then **Something else…** → "Train a competitor model" → call again | "Approved purpose works, and even the approval says it doesn't mean safe. Anything else: R4." |
| 8 | B | Risk | **Risk reviewer** tab → Live grants → **Emergency revoke** → reason. Then in the requester window, call again | "Instant and permanent: R7. On GPUs it also kills running jobs; Kabir's sample grant shows that." |
| 9 | A | Any | **Try to break it** → **Run all** | "Ten attacks, each blocked by the server, each naming its rule. The same list is our test suite." |
| 10 | D | Owner | **History** → filter Denied → **Export JSON** | "Every decision, with its receipt, in an append-only history." |

**Optional extras if time allows:**
- **Owner** tab: GPU use on the H100 pool, with Arjun's running job from the sample data.
- **Admin** tab: People shows everyone who signed in and their roles, which come only from the directory; **Simulated time → +8 days** makes grants expire on screen (R6). Everyone sees a notice while it's on.
- Requester → an expired grant → **Need more time?** opens a new linked request: there is no extend button (R8).

### If something goes wrong

- **"Too many attempts" on NamoID:** stop signing in, wait about 30 minutes, use the windows that are already signed in.
- **The site is slow to load:** Render is waking up; wait 30 seconds.
- **Anything else:** play the recording, or show `npm run e2e:demo`, which runs this same story with the four accounts.

---

## 5. First real resource

**H100 GPU time on our college cluster.** The four roles map directly: student (requester), faculty guide (manager), IT security or ethics (risk reviewer), HPC admin (resource owner). For real, approval would create a scheduler booking (for example a Slurm reservation) for exactly the approved GPUs and window, revoke would cancel the jobs, and roles would come from the university's directory.

---

## 6. What we're honest about

- **Approval isn't safety.** The gate controls *access*, not *outcomes*.
- **We can't verify what a GPU job really does.** A job approved for evaluation could secretly be training. Approved images, no internet and GPU caps reduce that risk; they don't remove it.
- **Revoking a grant isn't revoking a NamoID session.** They're separate layers.
- **Roles are configuration.** The role directory is a setting; a production version would manage it in an admin UI with durable storage.
- **State lives in one process.** Fine for the demo; Render's free tier resets it when it sleeps.
- **Simulated time is a demo tool.** Admin only, logged, and announced to everyone while on.
- **Mock to real needs real work:** a credential broker, scheduler integration, durable storage and an incident process behind emergency revoke.

---

## 7. Likely judge questions

**"Isn't this just an approval workflow?"**
An approval workflow records that someone said yes. Our gate **enforces** what they said yes *to*: purpose, time, GPU count and revocation are checked by the server on every use. Try to break it shows it.

**"Why is NamoID essential here, not decoration?"**
Separation of duties only works if you know *who* someone really is, and shared logins are half our campus problem. NamoID gives every person a verified identity, and every rule, receipt, score and role is tied to it. Without it, "you can't approve your own request" means nothing.

**"Who decides who's a reviewer?"**
The operator, through a role directory matched on a NamoID-verified email. There is no way to pick a role in the app, and someone removed from the directory goes back to requester only. A test and the mutation check cover both.

**"Can a requester see other people's data?"**
No. The server filters every list (requests, grants, jobs, history) to what the caller may see, and a test checks over HTTP that nothing about another person comes back. A grant's key is shown only to its holder.

**"If purposes are free text, how do you enforce them?"**
The approved wording is locked into the grant. Every use must name one of those purposes; we ignore case and spacing, nothing else. Narrowing can drop a purpose but never add or reword one.

**"What stops a reviewer from approving everything?"**
Three independent reviewers, any of whom can reject. Narrowing is easy and visible. Every decision needs a reason and stays in the history. We don't fix human judgement; we make it visible and accountable.

**"Why not let high scorers skip review?"**
We considered it and said no. Letting a score override people is exactly the automated decision a responsible-AI system should avoid. A test proves the score changes nothing.

**"How do you know your tests actually work?"**
We removed each of 18 protections one at a time and checked a test failed every time. Our first version of that check had a bug that reported everything as caught; a control run exposed it, and DECISIONS.md tells that story.

**"What happens at the exact second a grant expires?"**
Status is computed from the clock on every call, so at `expiresAt` the next call is refused (R6). There's no background job to miss, and a test covers that exact millisecond.

**"What was hardest?"**
*(Each speaker answers for their lane, one honest sentence each.)*

---

## 8. Closing line

> We didn't build a way to say *yes*. We built a way to say *yes, but only this much, only for this, only until then*, and to make that stick.
