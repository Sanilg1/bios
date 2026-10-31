import { test, describe, after, before } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, runAttack } from "../server/breakit/sandbox.js";
import { ATTACKS } from "../server/breakit/attacks.js";

describe("T7 auth boundary (HTTP)", () => {
  let sandbox;
  before(async () => {
    sandbox = await createSandbox();
  });
  after(() => sandbox.close());

  test("every protected route answers 401 with R0 without a session", async () => {
    for (const [method, path] of [
      ["get", "/api/grants"],
      ["get", "/api/requests"],
      ["get", "/api/history"],
      ["post", "/api/use"],
      ["post", "/api/jobs"],
      ["post", "/api/requests"],
    ]) {
      const res = await sandbox.api.anonymous()[method](path, {});
      assert.equal(res.status, 401, `${method.toUpperCase()} ${path}`);
      assert.equal(res.body.rule, "R0");
    }
  });

  test("a signed-in user gets through, and holder-only credentials are hidden from others", async () => {
    const { api } = sandbox;
    const created = await api.as("persona:maya").post("/api/requests", {
      resourceId: "model:sentinel-eval-mock",
      purposes: ["evaluation"],
      durationDays: 7,
      controls: [],
      justification: "eval",
    });
    assert.equal(created.status, 201);
    const id = created.body.request.id;
    for (const [slot, sub] of [["manager", "persona:guide"], ["risk", "persona:risk"], ["owner", "persona:ira"]]) {
      const r = await api.as(sub).post(`/api/requests/${id}/reviews`, { slot, decision: "approve", reason: "ok" });
      assert.equal(r.status, 200);
    }
    const mine = await api.as("persona:maya").get("/api/grants");
    const theirs = await api.as("persona:risk").get("/api/grants");
    assert.match(mine.body[0].credential, /^mock_key_/);
    assert.equal(theirs.body[0].credential, null);
  });

  test("each reviewer dashboard needs its role over HTTP too", async () => {
    const { api } = sandbox;
    const denied = await api.as("persona:maya").get("/api/dashboards/risk");
    assert.equal(denied.status, 403);
    assert.equal(denied.body.rule, "R11");
    for (const [role, sub] of [["manager", "persona:guide"], ["risk", "persona:risk"], ["owner", "persona:ira"]]) {
      const ok = await api.as(sub).get(`/api/dashboards/${role}`);
      assert.equal(ok.status, 200, role);
      assert.equal(ok.body.role, role);
    }
    assert.equal((await api.as("persona:guide").get("/api/dashboards/admin")).status, 404);
  });

  test("cross-site origins can't change state", async () => {
    const res = await fetch(`${sandbox.baseUrl}/api/requests`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example", "x-test-user": "persona:maya" },
      body: JSON.stringify({ resourceId: "model:sentinel-eval-mock", purposes: ["evaluation"], durationDays: 1, controls: [], justification: "csrf" }),
    });
    assert.equal(res.status, 403);
  });

  test("a cookie-carrying state change without Origin is refused unless Sec-Fetch-Site says same-origin", async () => {
    const post = (headers) =>
      fetch(`${sandbox.baseUrl}/api/requests`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": "persona:maya", ...headers },
        body: JSON.stringify({ resourceId: "model:sentinel-eval-mock", purposes: ["evaluation"], durationDays: 1, controls: [], justification: "csrf" }),
      });
    assert.equal((await post({ cookie: "netra_gate_session=stolen" })).status, 403, "cookie, no Origin, no Sec-Fetch-Site");
    assert.equal((await post({ cookie: "netra_gate_session=x", "sec-fetch-site": "cross-site" })).status, 403, "cross-site fetch metadata");
    assert.equal((await post({ "sec-fetch-site": "same-site" })).status, 403, "a sibling subdomain is not our origin");
    assert.equal((await post({ cookie: "netra_gate_session=x", "sec-fetch-site": "same-origin" })).status, 201, "same-origin fetch metadata");
    assert.equal((await post({})).status, 201, "cookieless callers have no ambient session to forge");
  });
});

describe("T10 break-it parity", () => {
  for (const attack of ATTACKS) {
    test(`${attack.id} is blocked by ${attack.rule}`, async () => {
      const result = await runAttack(attack.id);
      assert.equal(result.final.rule, attack.rule, result.final.receipt);
      assert.ok(result.blocked);
      assert.ok(result.final.status >= 400);
      assert.ok(result.final.receipt?.length > 0);
    });
  }

  test("every catalogued attack rule is distinct and the panel covers the PRD list", () => {
    const rules = ATTACKS.map((a) => a.rule).sort();
    assert.deepEqual(rules, ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"].sort());
  });
});
