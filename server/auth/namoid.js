// NamoID Hosted Auth as the app's sign-in system: OIDC Authorization Code + S256 PKCE, confidential client.
// Adapted from namoidhq/namoid-examples/hosted-auth/express-react. Tokens never leave the server.
import { createNamoIDClient } from "@namoidhq/js";
import { validateOIDCIdToken } from "@namoidhq/js/server";
import rateLimit from "express-rate-limit";
import { route } from "../http.js";

const TRANSACTION_LIFETIME_MS = 10 * 60 * 1000;
const REFRESH_SKEW_MS = 60 * 1000;
const REFRESH_REUSE_MS = 30 * 1000;

export function namoidProvider({ clientId, clientSecret, namoid = createNamoIDClient({ clientId }) }) {
  const inflightRefresh = new Map();
  const authRateLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });

  function mount(app, { appBaseUrl }) {
    app.post("/api/auth/login", authRateLimit, route(async (req, res) => {
      let started;
      try {
        started = await namoid.hostedAuth.start({
          redirectUri: `${appBaseUrl}/api/auth/callback`,
          scopes: ["openid", "email", "offline_access"],
        });
      } catch (error) {
        console.error("Hosted Auth start failed", safeError(error));
        res.status(502).json({ error: `NamoID couldn't start sign-in (${safeError(error)}). Check the Client ID and environment.` });
        return;
      }
      req.session.namoidTransaction = {
        state: started.transaction.state,
        nonce: started.transaction.nonce,
        codeVerifier: started.transaction.codeVerifier,
        redirectUri: started.transaction.redirectUri,
        createdAt: started.transaction.createdAt,
      };
      await saveSession(req);
      res.json({ authorizationUrl: started.authorizationUrl });
    }));

    app.get("/api/auth/callback", authRateLimit, route(async (req, res) => {
      const errorCode = stringQuery(req.query.error);
      const code = stringQuery(req.query.code);
      const returnedState = stringQuery(req.query.state);
      const transaction = req.session.namoidTransaction;
      delete req.session.namoidTransaction;

      if (
        errorCode ||
        !code ||
        !returnedState ||
        !transaction ||
        transaction.state !== returnedState ||
        Date.now() - transaction.createdAt > TRANSACTION_LIFETIME_MS
      ) {
        await saveSession(req);
        res.redirect(303, "/?auth_error=callback");
        return;
      }

      try {
        const discovery = await namoid.auth.getDiscovery();
        if (discovery.authorization_response_iss_parameter_supported && stringQuery(req.query.iss) !== discovery.issuer) {
          throw new Error("authorization_response_issuer_mismatch");
        }
        const tokens = await namoid.hostedAuth.exchangeCode({
          code,
          redirectUri: transaction.redirectUri,
          codeVerifier: transaction.codeVerifier,
          clientSecret,
        });
        if (!tokens.id_token) throw new Error("id_token_missing");
        const claims = await validateOIDCIdToken({ idToken: tokens.id_token, discovery, clientId, nonce: transaction.nonce });
        const identity = await namoid.hostedAuth.userInfo(tokens.access_token);
        if (identity.sub !== claims.sub) throw new Error("userinfo_subject_mismatch");

        await regenerateSession(req);
        req.session.namoidAuth = {
          tokens,
          userId: identity.sub,
          // Display only. Never used as a key: the stable key is `sub`.
          displayName: identity.name || identity.preferred_username || identity.email || identity.sub,
          sessionId: typeof claims.sid === "string" ? claims.sid : null,
          expiresAt: tokenExpiry(tokens),
        };
        await saveSession(req);
        res.redirect(303, "/");
      } catch (error) {
        console.error("Hosted Auth callback failed", safeError(error));
        res.redirect(303, "/?auth_error=exchange");
      }
    }));

    app.post("/api/auth/logout", route(async (req, res) => {
      const auth = req.session.namoidAuth;
      let logoutUrl = appBaseUrl;
      if (auth) {
        try {
          const current = await refreshIfNeeded(auth);
          const token = current.tokens.refresh_token ?? current.tokens.access_token;
          await namoid.hostedAuth.revoke({
            token,
            tokenTypeHint: current.tokens.refresh_token ? "refresh_token" : "access_token",
            clientSecret,
          });
          if (current.tokens.id_token) {
            logoutUrl = await namoid.hostedAuth.getLogoutUrl({ idTokenHint: current.tokens.id_token, postLogoutRedirectUri: appBaseUrl });
          }
        } catch (error) {
          console.error("NamoID revocation failed", safeError(error));
        }
      }
      await destroySession(req);
      res.clearCookie("netra_gate_session");
      res.json({ logoutUrl });
    }));
  }

  async function identify(req) {
    const auth = req.session?.namoidAuth;
    if (!auth) return null;
    try {
      const current = await refreshIfNeeded(auth);
      if (current !== auth) {
        req.session.namoidAuth = current;
        await saveSession(req);
      }
      return { sub: current.userId, name: current.displayName, via: "namoid" };
    } catch (error) {
      // A failed refresh (e.g. replayed token family) is terminal: clear and require a fresh sign-in.
      console.error("Session refresh failed", safeError(error));
      delete req.session.namoidAuth;
      await saveSession(req);
      return null;
    }
  }

  async function refreshIfNeeded(auth) {
    if (Date.now() < auth.expiresAt - REFRESH_SKEW_MS) return auth;
    const refreshToken = auth.tokens.refresh_token;
    if (!refreshToken) throw new Error("refresh_token_missing");
    // Single-flight per refresh token. Parallel API calls near expiry share one refresh, so a
    // rotating provider never sees the same refresh token twice (which would kill the token family).
    // The result is kept briefly for requests that loaded the session before it was re-saved.
    let pending = inflightRefresh.get(refreshToken);
    if (!pending) {
      pending = namoid.hostedAuth.refresh({ refreshToken, clientSecret }).then((refreshed) => {
        const tokens = {
          ...refreshed,
          refresh_token: refreshed.refresh_token ?? refreshToken,
          id_token: refreshed.id_token ?? auth.tokens.id_token,
        };
        return { tokens, expiresAt: tokenExpiry(tokens) };
      });
      inflightRefresh.set(refreshToken, pending);
      const forget = () => setTimeout(() => inflightRefresh.delete(refreshToken), REFRESH_REUSE_MS).unref();
      pending.then(forget, () => inflightRefresh.delete(refreshToken));
    }
    const { tokens, expiresAt } = await pending;
    return { ...auth, tokens, expiresAt };
  }

  return { name: "namoid", mount, identify };
}

function tokenExpiry(tokens) {
  return Date.now() + Math.max(1, tokens.expires_in ?? 900) * 1000;
}

function stringQuery(value) {
  return typeof value === "string" && value ? value : null;
}

function safeError(error) {
  return error instanceof Error ? error.message : "unknown_error";
}

export function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
}

export function destroySession(req) {
  return new Promise((resolve, reject) => req.session.destroy((error) => (error ? reject(error) : resolve())));
}
