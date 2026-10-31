// Express app factory. The same routes serve the real app, the tests and the break-it sandbox.
import express from "express";
import session from "express-session";
import helmet from "helmet";
import { Denied, NotFound, RULES } from "./policy/rules.js";
import { APPROVED_IMAGES, CONTROLS, MAX_DURATION_DAYS, PERSONAS, PURPOSES, ROLES } from "./policy/catalog.js";
import { ATTACKS } from "./breakit/attacks.js";
import { runAttack } from "./breakit/sandbox.js";
import { route } from "./http.js";

export function createApp({ gate, auth, sessionSecret, appBaseUrl = "http://localhost:5174", demoMode = false, staticDir = null, trustProxy = 1 }) {
  const app = express();
  const secure = appBaseUrl.startsWith("https://");
  const appOrigin = new URL(appBaseUrl).origin;

  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: secure ? [] : null,
        },
      },
      strictTransportSecurity: secure ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "16kb" }));
  app.use(
    session({
      name: "netra_gate_session",
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax", secure, maxAge: 8 * 60 * 60 * 1000 },
    }),
  );
  app.use("/api", (_req, res, next) => {
    res.setHeader("cache-control", "no-store");
    next();
  });
  // CSRF defence alongside SameSite=Lax. Browsers send Origin on every non-GET fetch, and
  // Sec-Fetch-Site too. A state change that carries a cookie but proves neither is refused.
  // Cookieless callers (tests, the break-it sandbox, curl) have no ambient session to forge.
  app.use("/api", (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    const origin = req.get("origin");
    const fetchSite = req.get("sec-fetch-site");
    const sameOrigin = origin ? origin === appOrigin : fetchSite ? fetchSite === "same-origin" : !req.get("cookie");
    if (!sameOrigin) {
      res.status(403).json({ error: "Invalid request origin" });
      return;
    }
    next();
  });

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  auth.mount(app, { gate, appBaseUrl, secure });

  app.get("/api/auth/options", (_req, res) => {
    res.json({
      namoid: auth.namoidEnabled,
      devLogin: auth.devLoginEnabled,
      personas: auth.devLoginEnabled ? PERSONAS : [],
      demoMode,
    });
  });

  // Every route below needs a signed-in user (R0).
  const requireUser = route(async (req, _res, next) => {
    const identity = await auth.identify(req);
    if (!identity) throw new Denied("R0", "Denied (R0): sign in through NamoID Hosted Auth first.");
    req.user = gate.upsertUser(identity);
    next();
  });

  app.get("/api/session", route(async (req, res) => {
    const identity = await auth.identify(req);
    if (!identity) {
      res.json({ authenticated: false, demoMode });
      return;
    }
    const user = gate.upsertUser(identity);
    res.json({ authenticated: true, user, via: identity.via, demoMode, now: gate.now() });
  }));

  const api = express.Router();
  api.use(requireUser);

  api.get("/meta", (_req, res) => {
    res.json({ rules: RULES, purposes: PURPOSES, controls: CONTROLS, roles: ROLES, images: APPROVED_IMAGES, maxDurationDays: MAX_DURATION_DAYS, now: gate.now() });
  });
  api.get("/resources", (_req, res) => res.json(gate.resources()));
  api.get("/requests", (_req, res) => res.json(gate.listRequests()));
  api.post("/requests", (req, res) => res.status(201).json(gate.createRequest(req.user.sub, req.body)));
  api.post("/requests/:id/reviews", (req, res) => res.json(gate.review(req.user.sub, req.params.id, req.body)));
  api.get("/grants", (req, res) => res.json(gate.listGrants(req.user.sub)));
  api.post("/grants/:id/revoke", (req, res) => res.json(gate.revoke(req.user.sub, req.params.id, req.body?.reason)));
  // R8: there is deliberately no way to edit a grant. These routes exist only to say so, and log the attempt.
  for (const method of ["patch", "put"]) api[method]("/grants/:id", (req, res) => res.json(gate.attemptExpiryChange(req.user.sub, req.params.id)));
  api.post("/grants/:id/extend", (req, res) => res.json(gate.attemptExpiryChange(req.user.sub, req.params.id)));
  api.post("/use", (req, res) => res.json(gate.use(req.user.sub, req.body)));
  api.get("/jobs", (_req, res) => res.json(gate.listJobs()));
  api.post("/jobs", (req, res) => res.status(201).json(gate.submitJob(req.user.sub, req.body)));
  // The UI gets the newest events (default 500); the export below stays complete.
  api.get("/history", (req, res) => res.json(gate.history({ ...req.query, limit: req.query.limit ?? 500 })));
  api.get("/history/export", (req, res) => {
    res.setHeader("content-disposition", 'attachment; filename="access-history.json"');
    res.json({ exportedAt: new Date(gate.now()).toISOString(), note: "Mock data only. Approval ≠ safety.", events: gate.history(req.query) });
  });
  api.get("/score/:sub", (req, res) => {
    const viewer = req.user;
    const reviewer = ["manager", "risk", "owner"].some((role) => viewer.roles.includes(role));
    if (viewer.sub !== req.params.sub && !reviewer) throw new Denied("R11", "Denied (R11): only reviewers or the person themselves can see a score.");
    res.json(gate.score(req.params.sub));
  });

  api.get("/breakit", (_req, res) => res.json(ATTACKS.map(({ id, title, rule, tries }) => ({ id, title, rule, tries }))));
  api.post("/breakit/:id", route(async (req, res) => {
    res.json(await runAttack(req.params.id));
  }));

  if (demoMode) {
    api.post("/demo/roles", (req, res) => res.json(gate.setRoles(req.user.sub, req.user.sub, req.body?.roles ?? [])));
    api.post("/demo/clock", (req, res) => {
      const hours = Number(req.body?.hours);
      if (!(hours > 0 && hours <= 24 * 60)) throw new Denied("R12", "Denied (R12): advance between 1 hour and 60 days.");
      res.json(gate.demoAdvanceClock(req.user.sub, hours));
    });
  }

  app.use("/api", api);

  if (staticDir) {
    app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile("index.html", { root: staticDir }));
  }

  app.use((error, _req, res, _next) => {
    if (error instanceof Denied) {
      res.status(error.status).json(error.toJSON());
      return;
    }
    if (error instanceof NotFound) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    console.error("Request failed", error instanceof Error ? error.message : "unknown_error");
    res.status(500).json({ error: "The request could not be completed" });
  });

  return app;
}

