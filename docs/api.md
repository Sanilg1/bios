# API contract

Every route except auth, `/api/health` and `/api/auth/options` needs a signed-in session. Without one: `401 { allowed:false, rule:"R0", receipt }`.

State-changing requests (anything but GET/HEAD) must send our `Origin`, or `Sec-Fetch-Site: same-origin`. If a request carries a cookie and has neither, it gets `403 { error: "Invalid request origin" }`. Browsers send these headers automatically.

Denials always look like `{ allowed:false, rule:"R4", ruleTitle, receipt:"Denied (R4): …" }`, with the HTTP status from the rule catalogue (`GET /api/meta` → `rules`). Allows include `allowed:true` and a `receipt`.

## Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | → `{ authorizationUrl }` (NamoID Hosted Auth) |
| GET | `/api/auth/callback` | NamoID redirect target. Validates, creates the session, redirects to `/` |
| POST | `/api/auth/logout` | Revokes at NamoID, destroys the session → `{ logoutUrl }` |
| POST | `/api/auth/dev-login` | `{ sub }`. Only when `DEV_LOGIN=true` (refused in production) |
| GET | `/api/auth/options` | `{ namoid, devLogin, personas, demoMode }` |
| GET | `/api/session` | `{ authenticated, user:{sub,name,roles}, via, demoMode, now }` |

## Gate
| Method | Path | Body | Rules that can deny |
|---|---|---|---|
| GET | `/api/meta` | | |
| GET | `/api/resources` | | |
| GET | `/api/requests` | | |
| POST | `/api/requests` | `{ resourceId, purposes[], durationDays, controls[], gpuCount?, justification, extendsGrantId? }` | R11, R12, R13, R7 |
| POST | `/api/requests/:id/reviews` | `{ slot: manager\|risk\|owner, decision: approve\|narrow\|reject, reason, narrowTo?: { purposes?, durationDays?, controls?, gpuCount? } }` | R1, R2, R3, R9, R11, R12 |
| GET | `/api/grants` | | (`credential` only for the holder) |
| POST | `/api/grants/:id/revoke` | `{ reason }` | R6, R7, R11, R12 |
| PATCH/PUT | `/api/grants/:id` | anything | always R8 (logged) |
| POST | `/api/grants/:id/extend` | anything | always R8 (logged) |
| POST | `/api/use` | `{ credential, resourceId, purpose, input }` → `{ output, banner, receipt }` | R4, R6, R7, R13 |
| GET | `/api/jobs` | | |
| POST | `/api/jobs` | `{ credential, gpus, purpose, image, hours }` | R4, R5, R6, R7, R10, R12, R13 |
| GET | `/api/history` | query `requestId`, `resourceId`, `grantId`, `limit` (newest N; default 500, max 5000) | |
| GET | `/api/history/export` | same filters, never limited | JSON download |
| GET | `/api/score/:sub` | | R11 unless you're a reviewer or the person |
| GET | `/api/breakit` | | |
| POST | `/api/breakit/:id` | | runs in a fresh sandbox → `{ blocked, final, transcript }` |
| POST | `/api/demo/roles` | `{ roles[] }` | `DEMO_MODE` only, audited |
| POST | `/api/demo/clock` | `{ hours }` | `DEMO_MODE` only, audited |
