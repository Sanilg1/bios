import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { seedDemoData } from "../server/demo/seed.js";
import { makeGate, GUIDE, RISK, IRA } from "./helpers.js";

describe("demo seed data", () => {
  test("plays ten days through the real engine and leaves every dashboard with work, at the real current time", () => {
    const { gate, clock } = makeGate();
    const before = clock.now();
    seedDemoData(gate, clock);
    assert.equal(clock.now(), before, "the clock is put back exactly");

    const byStatus = (status) => gate.listGrants(GUIDE).filter((g) => g.status === status).map((g) => g.holderName);
    assert.deepEqual(byStatus("active").sort(), ["Arjun Desai", "Priya Nair"]);
    assert.deepEqual(byStatus("expired"), ["Maya Rao"]);
    assert.deepEqual(byStatus("revoked"), ["Kabir Singh"]);
    assert.equal(gate.listRequests().filter((r) => r.status === "rejected").length, 1);
    assert.equal(gate.listJobs().filter((j) => j.status === "running").length, 1);

    assert.equal(gate.dashboard(GUIDE, "manager").actionable.length, 2);
    assert.equal(gate.dashboard(RISK, "risk").actionable.length, 3);
    assert.equal(gate.dashboard(IRA, "owner").actionable.length, 4);

    const history = gate.history();
    const denied = history.filter((e) => !e.allowed).map((e) => e.rule);
    for (const rule of ["R1", "R4", "R5", "R6", "R7", "R8", "R10"]) assert.ok(denied.includes(rule), `history shows a ${rule} denial`);
    assert.ok(history.every((e, i) => i === 0 || e.at >= history[i - 1].at), "history is in time order");
    assert.ok(gate.score("persona:kabir").score < 50, "Kabir's revocation shows in his score");
  });
});
