// Server entry point. Configuration comes from the environment (see .env.example).
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createAuth } from "./auth/index.js";
import { createClock, createGate } from "./policy/engine.js";
import { loadState, snapshotter } from "./store.js";

const production = process.env.NODE_ENV === "production";
const flag = (name) => process.env[name]?.trim().toLowerCase() === "true";

const appBaseUrl = (process.env.APP_BASE_URL ?? "http://localhost:5174").replace(/\/+$/, "");
const port = Number(process.env.PORT ?? "4000");
const demoMode = flag("DEMO_MODE");
const devLogin = flag("DEV_LOGIN");
const dataFile = process.env.DATA_FILE ?? "data/state.json";

if (production && devLogin) {
  throw new Error("DEV_LOGIN is refused in production. Sign-in must go through NamoID Hosted Auth.");
}

let sessionSecret = process.env.SESSION_SECRET?.trim();
if (!sessionSecret) {
  if (production) throw new Error("SESSION_SECRET is required");
  sessionSecret = randomBytes(32).toString("hex");
  console.warn("SESSION_SECRET not set; using a random one (sessions reset on restart).");
}
if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");

const clientId = process.env.NAMOID_CLIENT_ID?.trim();
const clientSecret = process.env.NAMOID_CLIENT_SECRET?.trim();
const namoid = clientId && clientSecret ? { clientId, clientSecret } : null;
if (!namoid) {
  if (production) throw new Error("NAMOID_CLIENT_ID and NAMOID_CLIENT_SECRET are required in production");
  console.warn("NamoID is not configured; only dev login is available.");
}

const state = loadState(dataFile, { withPersonas: demoMode || devLogin });
const clock = createClock(state.clockOffsetMs ?? 0);
const gate = createGate({ state, clock, onChange: snapshotter(dataFile) });

const clientDist = fileURLToPath(new URL("../client/dist", import.meta.url));
const app = createApp({
  gate,
  auth: createAuth({ namoid, devLogin }),
  sessionSecret,
  appBaseUrl,
  demoMode,
  staticDir: existsSync(clientDist) ? clientDist : null,
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Netra access gate on http://0.0.0.0:${port} (app URL ${appBaseUrl})`);
  console.log(`NamoID Hosted Auth: ${namoid ? "on" : "off"} · dev login: ${devLogin ? "on" : "off"} · demo mode: ${demoMode ? "on" : "off"}`);
});
