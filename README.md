# Responsible AI Access Gate

**[Powered by NamoID](https://namoid.in)** · [NamoID documentation](https://docs.namoid.in) · [Challenge catalog](https://challenges.namoid.in)

An independent community build by Team Netra for the NamoID `responsible-ai-access-gate` challenge, created from the official [NamoID challenge template](https://github.com/namoidhq/namoid-challenge-template). Not an official NamoID product, security recommendation, or endorsement.

**No permanent keys.** People request a mock model, dataset or H100 GPU time with a purpose, a duration and risk controls. A manager, a risk reviewer and the resource owner each approve, narrow or reject. Access starts and expires on its own, works only for the approved purpose, and can be revoked instantly. Every decision gets a receipt.

> Everything is mock. Approval authorizes use under stated conditions; it does **not** make use safe.

## NamoID integration

- NamoID Hosted Auth is the only sign-in: a confidential web app using OIDC Authorization Code with S256 PKCE via `@namoidhq/js` ([server/auth/namoid.js](server/auth/namoid.js)).
- The server checks `state`, issuer, the ID token and the UserInfo `sub`, then sets its own `HttpOnly` session cookie. Tokens never reach the browser.
- Users are keyed by NamoID `sub`. Reviewer roles come from an operator-set directory matched on a NamoID-verified email.
- Callback: `<APP_BASE_URL>/api/auth/callback`. Sign-out revokes the refresh token and ends the NamoID session.

## Run

Requires Node 24.

```bash
npm install
cp .env.example .env   # NamoID Client ID and Secret, session secret
npm run dev            # http://localhost:5174
npm test               # 63 tests
```

## First real resource

H100 GPU time on our college cluster: student (requester), faculty guide (manager), IT security (risk reviewer), HPC admin (resource owner).
