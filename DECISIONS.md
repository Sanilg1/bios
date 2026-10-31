# Engineering decisions

> Draft written while building. **Team Netra: rewrite this in your own words before submitting.** Judges read this file, and real trade-offs in your voice matter more than polish.

## Scope

**Completed within the timebox:**
- NamoID Hosted Auth sign-in
- requests for mock models, datasets and a mock H100 pool
- three-slot review with approve, narrow and reject
- separation of duties
- automatic expiry
- purpose- and GPU-bound use
- no silent extensions
- emergency revocation
- active grants and an append-only history with decision receipts
- the "Try to break it" panel
- the advisory confidence score
- tests T1–T10 and a mutation check

**Deliberately left out:**
- **Risk-tiered routing.** All three reviewers are always required (D2), and the score never routes anything (D9).
- **A requester "accept narrowed terms" step.**
- **Durable storage and an admin-managed role table.**
- **Real scheduler or credential integration.**

## Architecture

```
Browser (React, built by Vite)  ── HttpOnly session cookie only ──▶  Express (Node 24)
                                                                     ├─ auth: NamoID Hosted Auth (OIDC + PKCE, confidential client)
                                                                     ├─ routes: thin, no rules
                                                                     ├─ policy engine: every rule, receipts, rule catalogue R0–R13
                                                                     ├─ score: advisory, read-only over state
                                                                     └─ store: in-memory + JSON snapshot
```

- **One place for rules.** [server/policy/engine.js](server/policy/engine.js) has no Express or NamoID imports. Routes only translate HTTP to engine calls, so the tests, the UI and the break-it panel all exercise the same code.
- **Time is computed, not scheduled.** `active` / `expired` is derived from an injectable clock on every read and use. Expiry can't be missed by a crashed cron job, and tests can jump to the exact millisecond of expiry.
- **Immutability is enforced by the language.** A grant's scope and `expiresAt` are non-writable properties, and audit entries are frozen. Assigning to them throws, which is how T5 proves "no silent extension".
- **The break-it panel uses a real sandbox.** Each attack starts a fresh copy of the app (same routes, same engine, its own state and clock) on an ephemeral port and attacks it over HTTP. The same attack list is the T10 test suite, so the panel and the tests can't disagree.

## Security and privacy

- **Secrets:** the NamoID Client Secret and session secret live only in server environment variables (`.env` is git-ignored).
- **Tokens:** NamoID tokens live only in the server-side session. The browser gets an opaque `HttpOnly`, `SameSite=Lax` cookie (`Secure` over HTTPS).
- **CSRF:** on top of `SameSite=Lax`, a state-changing request must come from our `Origin`. If it has no `Origin`, its `Sec-Fetch-Site` must say `same-origin`. If it has neither and still carries a cookie, it is refused. An outside review pointed out that our first version let a request with no `Origin` through.
- **Token refresh:** parallel API calls near token expiry share one refresh, so NamoID never sees the same refresh token twice. Seeing it twice could end the session if NamoID rotates refresh tokens. The other review findings we fixed: snapshot write failures are logged instead of crashing the process; audit entries record the actor's name when written, so a rename can't rewrite history; and an extension approved after the old grant expired says so in its receipt instead of silently leaving a gap.
- **CSP:** helmet sets `default-src 'self'`.
- **Credentials:** mock credentials are shown only to the grant holder and never written to the audit log (a test checks this).
- **Identity:** users are keyed by NamoID `sub`. Display names are cosmetic.
- **Before production we would harden:**
  - a durable session store and an admin-managed role table
  - rate limits on API routes (only auth routes are limited today)
  - removing demo mode entirely from production builds
  - step-up re-authentication for approve/revoke
  - real short-lived credentials from a broker

## Testing

`npm test` runs 52 tests on Node's built-in runner with a fixed clock and no network (the table below, plus [test/hardening.test.js](test/hardening.test.js) for token refresh and snapshot failures):

| Group | What it proves |
|---|---|
| T1 Separation of duties | No self-review in any slot even with every role; one person, one slot; the owner slot needs the real owner |
| T2 Expiry | Active until `expiresAt − 1ms`, expired at `expiresAt`; jobs die with their grant |
| T3 Narrowed scope | The grant carries the narrowed scope; removed purposes and extra GPUs are denied; narrowing can't widen |
| T4 Emergency revocation | Immediate denial, running jobs killed, logged, terminal; only risk or owner can revoke |
| T5 No silent extensions | Expiry can't be reassigned; extension = new request + full review |
| T6 Purpose / holder | Wrong purpose, wrong holder, wrong resource, unknown credential, unapproved image |
| T7 Auth boundary | 401/R0 without a session over HTTP; cross-site origins rejected; a cookie without `Origin` or same-origin `Sec-Fetch-Site` rejected |
| T8 Receipts | Allows say "not a safety guarantee"; history is append-only; no credentials in logs |
| T9 Score is advisory | A score below 20 and one above 60 get identical review requirements and grants |
| T10 Break-it parity | Every panel attack is blocked by its expected rule |
| T11 Reviewer dashboards | Each dashboard needs its role (R11, logged); a reviewer sees only what they may act on; owners see only their resources; no credentials leak |

**Do the tests bite?** [scripts/mutation-check.mjs](scripts/mutation-check.mjs) removes each rule from a scratch copy, one at a time, and reruns the suite. A control run without mutation must pass first. Our first version of this script had a bug: it reported every mutant as "caught" because the test runner was failing for an unrelated reason. Adding the control run exposed it. Results are in [samples/mutation-report.md](samples/mutation-report.md): all 16 mutants are caught.

We prioritised these because they are the challenge's required tests, and because "prevent X" claims are only worth something if removing the prevention makes a test fail.

## With another hour

1. Configure the real NamoID Console app and record the end-to-end sign-in.
2. Deploy (one Node process serves API + UI).
3. Step-up re-authentication through NamoID before approve and revoke.
