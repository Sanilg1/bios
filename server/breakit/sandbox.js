// A throwaway copy of the real app (same routes, same policy engine) with its own state and clock.
// Sandbox actors are fictional personas identified by a test header; that header auth exists only here.
import { randomBytes } from "node:crypto";
import { createApp } from "../app.js";
import { headerAuth } from "../auth/index.js";
import { createGate, DAY, fixedClock } from "../policy/engine.js";
import { seedState } from "../store.js";
import { ATTACKS } from "./attacks.js";

export async function createSandbox() {
  const state = seedState({ withPersonas: true });
  state.users["persona:outsider-owner"] = { sub: "persona:outsider-owner", name: "Omar (owner of nothing)", roles: [] };
  const clock = fixedClock();
  const gate = createGate({ state, clock });
  const app = createApp({ gate, auth: headerAuth(), sessionSecret: randomBytes(32).toString("hex"), appBaseUrl: "http://127.0.0.1" });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const transcript = [];

  const call = (actor) => async (method, path, body) => {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { "content-type": "application/json", ...(actor ? { "x-test-user": actor } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    transcript.push({ actor: actor ? state.users[actor]?.name ?? actor : "anonymous", method, path, body: body ?? null, status: res.status, response: json });
    return { status: res.status, body: json };
  };
  const verbs = (actor) => {
    const c = call(actor);
    return { get: (p) => c("GET", p), post: (p, b) => c("POST", p, b ?? {}), patch: (p, b) => c("PATCH", p, b ?? {}) };
  };

  const api = {
    as: verbs,
    anonymous: () => verbs(null),
    advanceDays(days) {
      clock.advance(days * DAY);
      transcript.push({ note: `Sandbox clock moved forward ${days} day(s)` });
    },
    setRoles(sub, roles, { ownsNothing = false } = {}) {
      gate.setRoles("sandbox", sub, roles);
      if (ownsNothing) for (const r of state.resources) r.ownerSubs = r.ownerSubs.filter((s) => s !== sub);
      transcript.push({ note: `Setup: ${state.users[sub]?.name ?? sub} given roles [${roles.join(", ")}]${ownsNothing ? ", owns no resources" : ""}` });
    },
  };

  return {
    api,
    baseUrl,
    gate,
    clock,
    transcript,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}

export async function runAttack(id) {
  const attack = ATTACKS.find((a) => a.id === id);
  if (!attack) return { error: `Unknown attack ${id}` };
  const sandbox = await createSandbox();
  try {
    const final = await attack.run(sandbox.api);
    const blocked = final.status >= 400 && final.body?.rule === attack.rule;
    return {
      id: attack.id,
      title: attack.title,
      rule: attack.rule,
      tries: attack.tries,
      blocked,
      final: { status: final.status, rule: final.body?.rule ?? null, receipt: final.body?.receipt ?? final.body?.error ?? null },
      transcript: sandbox.transcript,
    };
  } finally {
    await sandbox.close();
  }
}
