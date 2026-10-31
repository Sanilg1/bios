// Combines sign-in providers. NamoID Hosted Auth is the real one; dev login exists only for local
// work before the Console app is configured and is refused in production.
import { PERSONAS } from "../policy/catalog.js";
import { destroySession, namoidProvider, saveSession } from "./namoid.js";
import { route } from "../http.js";

export function createAuth({ namoid, devLogin }) {
  const providers = [];
  const namoidAuth = namoid ? namoidProvider(namoid) : null;
  if (namoidAuth) providers.push(namoidAuth);

  return {
    namoidEnabled: Boolean(namoidAuth),
    devLoginEnabled: Boolean(devLogin),

    mount(app, context) {
      if (namoidAuth) namoidAuth.mount(app, context);
      else {
        app.post("/api/auth/login", (_req, res) => res.status(503).json({ error: "NamoID is not configured. Set NAMOID_CLIENT_ID and NAMOID_CLIENT_SECRET." }));
        app.post("/api/auth/logout", route(async (req, res) => {
          await destroySession(req);
          res.clearCookie("netra_gate_session");
          res.json({ logoutUrl: "/" });
        }));
      }
      if (devLogin) {
        app.post("/api/auth/dev-login", route(async (req, res) => {
          const persona = PERSONAS.find((p) => p.sub === req.body?.sub);
          if (!persona) {
            res.status(404).json({ error: "Unknown persona" });
            return;
          }
          req.session.devUser = { sub: persona.sub, name: persona.name };
          await saveSession(req);
          res.json({ ok: true });
        }));
      }
    },

    async identify(req) {
      if (namoidAuth) {
        const identity = await namoidAuth.identify(req);
        if (identity) return identity;
      }
      if (devLogin && req.session?.devUser) return { ...req.session.devUser, via: "dev-login" };
      return null;
    },
  };
}

// Tests and the break-it sandbox only: identity comes from a header. Never wired into the real server.
export function headerAuth() {
  return {
    namoidEnabled: false,
    devLoginEnabled: false,
    mount() {},
    async identify(req) {
      const sub = req.get("x-test-user");
      return sub ? { sub, via: "test-header" } : null;
    },
  };
}
