import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NOT_SAFE } from "../server/policy/rules.js";
import { createGate, fixedClock, HOUR, parseDirectory } from "../server/policy/engine.js";
import { approve, approveAll, assertDenied, DAY, GUIDE, grantFor, H100, IRA, KABIR, makeGate, MAYA, NEEL, request, RISK, SENTINEL } from "./helpers.js";

describe("T1 separation of duties", () => {
  test("a requester can't review their own request in any slot, even holding every role", () => {
    const { gate } = makeGate();
    gate.setRoles(NEEL, NEEL, ["requester", "manager", "risk", "owner"]);
    const req = request(gate, NEEL);
    for (const slot of ["manager", "risk", "owner"]) {
      assertDenied(() => gate.review(NEEL, req.id, { slot, decision: "approve", reason: "mine" }), "R1");
    }
    assert.equal(gate.listRequests().find((r) => r.id === req.id).status, "in_review");
  });

  test("one person can't fill two slots on the same request", () => {
    const { gate } = makeGate();
    const req = request(gate);
    approve(gate, req.id, "manager", NEEL);
    assertDenied(() => gate.review(NEEL, req.id, { slot: "risk", decision: "approve", reason: "again" }), "R2");
  });

  test("a slot is decided once", () => {
    const { gate } = makeGate();
    const req = request(gate);
    approve(gate, req.id, "manager", GUIDE);
    assertDenied(() => gate.review(NEEL, req.id, { slot: "manager", decision: "approve", reason: "me too" }), "R2");
  });

  test("the owner slot needs the resource's actual owner, and slots need the matching role", () => {
    const { gate } = makeGate();
    const req = request(gate);
    gate.setRoles("test", "persona:omar", ["owner"]);
    gate.state.resources.forEach((r) => (r.ownerSubs = r.ownerSubs.filter((s) => s !== "persona:omar")));
    assertDenied(() => gate.review("persona:omar", req.id, { slot: "owner", decision: "approve", reason: "x" }), "R9");
    assertDenied(() => gate.review(GUIDE, req.id, { slot: "risk", decision: "approve", reason: "x" }), "R11");
  });

  test("denied review attempts are logged", () => {
    const { gate } = makeGate();
    gate.setRoles(NEEL, NEEL, ["requester", "manager"]);
    const req = request(gate, NEEL);
    assertDenied(() => gate.review(NEEL, req.id, { slot: "manager", decision: "approve", reason: "mine" }), "R1");
    const denied = gate.history({ requestId: req.id }).filter((e) => !e.allowed);
    assert.equal(denied.length, 1);
    assert.equal(denied[0].rule, "R1");
  });
});

describe("T2 automatic activation and expiry", () => {
  test("a grant is active until expiresAt and expired from that exact millisecond", () => {
    const { gate, clock } = makeGate();
    const grant = grantFor(gate);
    assert.equal(grant.expiresAt - grant.startsAt, 7 * DAY);
    const use = () => gate.use(MAYA, { credential: grant.credential, resourceId: SENTINEL, purpose: "evaluation", input: "x" });

    clock.advance(7 * DAY - 1);
    assert.equal(use().allowed, true);
    assert.equal(gate.listGrants(MAYA)[0].status, "active");

    clock.advance(1);
    assert.equal(gate.listGrants(MAYA)[0].status, "expired");
    assertDenied(use, "R6");
  });

  test("an expired grant can't be revoked back into anything; it stays expired", () => {
    const { gate, clock } = makeGate();
    const grant = grantFor(gate);
    clock.advance(8 * DAY);
    assertDenied(() => gate.revoke(RISK, grant.id, "late"), "R6");
    assert.equal(gate.listGrants(MAYA)[0].status, "expired");
  });

  test("running mock jobs die with their grant", () => {
    const { gate, clock } = makeGate();
    const grant = grantFor(gate, KABIR, { resourceId: H100, purposes: ["evaluation"], durationDays: 1, controls: [], gpuCount: 2 });
    const { job } = gate.submitJob(KABIR, { credential: grant.credential, gpus: 2, purpose: "evaluation", image: "netra/eval-harness:1.0", hours: 48 });
    assert.equal(job.status, "running");
    clock.advance(DAY);
    const after = gate.listJobs().find((j) => j.id === job.id);
    assert.equal(after.status, "killed");
    assert.equal(after.killReason, "grant expired");
  });
});

describe("T3 narrowed scope", () => {
  function narrowedH100(gate) {
    const req = request(gate, KABIR, { resourceId: H100, purposes: ["fine-tuning", "evaluation"], durationDays: 7, controls: [], gpuCount: 8 });
    approve(gate, req.id, "manager", GUIDE);
    const narrowed = gate.review(RISK, req.id, {
      slot: "risk",
      decision: "narrow",
      reason: "Start small",
      narrowTo: { purposes: ["evaluation"], durationDays: 3, gpuCount: 2, controls: ["no-network-egress"] },
    });
    assert.match(narrowed.receipt, /removed purpose fine-tuning/);
    assert.match(narrowed.receipt, /8 → 2 GPUs/);
    return approve(gate, req.id, "owner", IRA).grant;
  }

  test("the grant carries the narrowed scope, not the requested one", () => {
    const { gate } = makeGate();
    const grant = narrowedH100(gate);
    assert.deepEqual([...grant.purposes], ["evaluation"]);
    assert.equal(grant.gpuCount, 2);
    assert.equal(grant.expiresAt - grant.startsAt, 3 * DAY);
    assert.deepEqual([...grant.controls], ["no-network-egress"]);
  });

  test("using a narrowed-away purpose or more GPUs is denied", () => {
    const { gate } = makeGate();
    const grant = narrowedH100(gate);
    const job = (overrides) => gate.submitJob(KABIR, { credential: grant.credential, gpus: 2, purpose: "evaluation", image: "netra/eval-harness:1.0", hours: 2, ...overrides });
    assertDenied(() => job({ purpose: "fine-tuning" }), "R4");
    assertDenied(() => job({ gpus: 4 }), "R5");
    assert.equal(job({}).allowed, true);
    // GPUs already in use count against the grant.
    assertDenied(() => job({ gpus: 1 }), "R5");
  });

  test("narrowing can't widen anything", () => {
    const { gate } = makeGate();
    const req = request(gate, KABIR, { resourceId: H100, purposes: ["evaluation"], durationDays: 3, controls: ["no-network-egress"], gpuCount: 2 });
    const narrow = (narrowTo) => () => gate.review(RISK, req.id, { slot: "risk", decision: "narrow", reason: "x", narrowTo });
    assertDenied(narrow({ purposes: ["evaluation", "fine-tuning"] }), "R3");
    assertDenied(narrow({ durationDays: 10 }), "R3");
    assertDenied(narrow({ gpuCount: 4 }), "R3");
    assertDenied(narrow({ controls: [] }), "R3");
    assertDenied(narrow({}), "R12");
  });

  test("narrowing a model request removes the purpose from use", () => {
    const { gate } = makeGate();
    const req = request(gate, MAYA, { purposes: ["evaluation", "internal-research"], durationDays: 14 });
    approve(gate, req.id, "manager", GUIDE);
    gate.review(RISK, req.id, { slot: "risk", decision: "narrow", reason: "Evaluation only", narrowTo: { purposes: ["evaluation"], durationDays: 7 } });
    const grant = approve(gate, req.id, "owner", IRA).grant;
    assertDenied(() => gate.use(MAYA, { credential: grant.credential, resourceId: SENTINEL, purpose: "internal-research" }), "R4");
  });
});

describe("T4 emergency revocation", () => {
  test("revoke takes effect immediately, kills running jobs and is logged", () => {
    const { gate } = makeGate();
    const grant = grantFor(gate, KABIR, { resourceId: H100, purposes: ["fine-tuning"], durationDays: 3, controls: [], gpuCount: 2 });
    const { job } = gate.submitJob(KABIR, { credential: grant.credential, gpus: 2, purpose: "fine-tuning", image: "netra/finetune-lora:1.0", hours: 10 });

    const result = gate.revoke(RISK, grant.id, "Unexpected network traffic (demo)");
    assert.deepEqual(result.killedJobs, [job.id]);
    assert.equal(gate.listJobs().find((j) => j.id === job.id).status, "killed");
    assertDenied(() => gate.submitJob(KABIR, { credential: grant.credential, gpus: 1, purpose: "fine-tuning", image: "netra/finetune-lora:1.0" }), "R7");
    const event = gate.history({ grantId: grant.id }).find((e) => e.action === "grant.revoke");
    assert.equal(event.allowed, true);
    assert.match(event.receipt, /Unexpected network traffic/);
  });

  test("model use after revoke is denied, and revocation is terminal", () => {
    const { gate, clock } = makeGate();
    const grant = grantFor(gate);
    gate.revoke(IRA, grant.id, "Owner pulled access");
    assertDenied(() => gate.use(MAYA, { credential: grant.credential, resourceId: SENTINEL, purpose: "evaluation" }), "R7");
    clock.advance(HOUR);
    assertDenied(() => gate.revoke(RISK, grant.id, "again"), "R7");
    assert.equal(gate.listGrants(MAYA)[0].status, "revoked");
  });

  test("only risk reviewers or the resource owner can revoke, with a reason", () => {
    const { gate } = makeGate();
    const grant = grantFor(gate);
    assertDenied(() => gate.revoke(GUIDE, grant.id, "I'm the manager"), "R11");
    assertDenied(() => gate.revoke(MAYA, grant.id, "my own"), "R11");
    assertDenied(() => gate.revoke(RISK, grant.id, "  "), "R12");
  });
});

describe("T5 no silent extensions", () => {
  test("a grant's expiry and scope can't be reassigned", () => {
    const { gate } = makeGate();
    const grant = grantFor(gate);
    assert.throws(() => {
      grant.expiresAt += DAY;
    }, TypeError);
    assert.throws(() => grant.purposes.push("fine-tuning"), TypeError);
    assertDenied(() => gate.attemptExpiryChange(MAYA, grant.id), "R8");
  });

  test("more time is a new linked request with a full review, starting when the old grant ends", () => {
    const { gate } = makeGate();
    const grant = grantFor(gate);
    const ext = request(gate, MAYA, { extendsGrantId: grant.id });
    assert.equal(ext.status, "in_review");
    assert.equal(ext.extendsGrantId, grant.id);
    approve(gate, ext.id, "manager", GUIDE);
    approve(gate, ext.id, "risk", RISK);
    assert.equal(gate.listGrants(MAYA).length, 1, "no grant until all three slots decide");
    const next = approve(gate, ext.id, "owner", IRA).grant;
    assert.equal(next.startsAt, grant.expiresAt);
    assert.equal(gate.listGrants(MAYA).find((g) => g.id === next.id).status, "scheduled");
  });

  test("an extension approved after the old grant expired starts now and says so; it never backdates", () => {
    const { gate, clock } = makeGate();
    const grant = grantFor(gate);
    const ext = request(gate, MAYA, { extendsGrantId: grant.id });
    clock.advance(8 * DAY);
    approve(gate, ext.id, "manager", GUIDE);
    approve(gate, ext.id, "risk", RISK);
    const result = approve(gate, ext.id, "owner", IRA);
    assert.equal(result.grant.startsAt, clock.now());
    assert.ok(result.grant.startsAt > grant.expiresAt);
    assert.match(result.receipt, /no access from then until .+ Extensions never backdate\./);
  });

  test("a revoked grant can't be extended, and you can't extend someone else's", () => {
    const { gate } = makeGate();
    const grant = grantFor(gate);
    assertDenied(() => request(gate, KABIR, { extendsGrantId: grant.id }), "R13");
    gate.revoke(RISK, grant.id, "stop");
    assertDenied(() => request(gate, MAYA, { extendsGrantId: grant.id }), "R7");
  });
});

describe("T6 purpose and holder enforcement", () => {
  test("an active grant is used only by its holder, on its resource, for its purposes", () => {
    const { gate } = makeGate();
    const grant = grantFor(gate);
    const use = (sub, overrides) => () => gate.use(sub, { credential: grant.credential, resourceId: SENTINEL, purpose: "evaluation", input: "x", ...overrides });
    assertDenied(use(MAYA, { purpose: "fine-tuning" }), "R4");
    assertDenied(use(KABIR, {}), "R13");
    assertDenied(use(MAYA, { resourceId: "model:summarizer-mock" }), "R13");
    assertDenied(use(MAYA, { credential: "mock_key_made_up" }), "R13");
    const ok = use(MAYA, {})();
    assert.equal(ok.allowed, true);
    assert.equal(ok.output.label, "MOCK_LABEL_NOT_REAL");
  });

  test("approved-images-only blocks unknown images", () => {
    const { gate } = makeGate();
    const grant = grantFor(gate, KABIR, { resourceId: H100, purposes: ["evaluation"], durationDays: 1, controls: ["approved-images-only"], gpuCount: 1 });
    assertDenied(() => gate.submitJob(KABIR, { credential: grant.credential, gpus: 1, purpose: "evaluation", image: "random/miner:latest" }), "R10");
  });

  test("requests must fit the resource", () => {
    const { gate } = makeGate();
    assertDenied(() => request(gate, MAYA, { purposes: [] }), "R12");
    assertDenied(() => request(gate, MAYA, { purposes: ["  "] }), "R12");
    assertDenied(() => request(gate, MAYA, { purposes: ["x".repeat(121)] }), "R12");
    assertDenied(() => request(gate, MAYA, { purposes: ["one", "two", "three", "four"] }), "R12");
    assertDenied(() => request(gate, MAYA, { durationDays: 31 }), "R12");
    assertDenied(() => request(gate, MAYA, { controls: ["no-network-egress"] }), "R12");
    assertDenied(() => request(gate, KABIR, { resourceId: H100, gpuCount: 9, controls: [] }), "R12");
  });
});

describe("T8 receipts", () => {
  test("allows carry a not-a-safety-guarantee receipt and are logged", () => {
    const { gate } = makeGate();
    const grant = grantFor(gate);
    const ok = gate.use(MAYA, { credential: grant.credential, resourceId: SENTINEL, purpose: "evaluation" });
    assert.ok(ok.receipt.includes(NOT_SAFE));
    assert.equal(ok.banner, "Mock output. Authorization ≠ safety.");
    const last = gate.history().at(-1);
    assert.equal(last.action, "resource.use");
    assert.equal(last.allowed, true);
    assert.ok(!JSON.stringify(last).includes(grant.credential), "credentials never go into the audit log");
  });

  test("history is append-only", () => {
    const { gate } = makeGate();
    grantFor(gate);
    const [first] = gate.state.audit;
    assert.throws(() => {
      first.receipt = "rewritten";
    }, TypeError);
  });

  test("history keeps the actor's name from the time of the event, even after a rename", () => {
    const { gate } = makeGate();
    grantFor(gate);
    const before = gate.history().filter((e) => e.actorSub === MAYA);
    gate.upsertUser({ sub: MAYA, name: "Maya (renamed)" });
    const after = gate.history().filter((e) => e.actorSub === MAYA);
    assert.ok(before.length > 0);
    assert.deepEqual(after.map((e) => e.actorName), before.map((e) => e.actorName));
    assert.ok(after.every((e) => e.actorName !== "Maya (renamed)"));
  });

  test("history can be limited to the newest events; without a limit it is complete", () => {
    const { gate } = makeGate();
    grantFor(gate);
    const all = gate.history();
    const newest = gate.history({ limit: 2 });
    assert.deepEqual(newest.map((e) => e.seq), all.slice(-2).map((e) => e.seq));
    assert.equal(gate.history({ limit: 99999 }).length, all.length);
  });
});

describe("T9 confidence score stays advisory", () => {
  test("new users start neutral with no history", () => {
    const { gate } = makeGate();
    const s = gate.score(MAYA);
    assert.equal(s.score, 50);
    assert.equal(s.label, "No history yet");
    assert.deepEqual(s.factors, []);
  });

  test("score moves with in-app behaviour, with reasons", () => {
    const { gate, clock } = makeGate();
    const clean = grantFor(gate, MAYA);
    clock.advance(8 * DAY);
    assert.equal(gate.score(MAYA).score, 50 + 2 + 5, "approved exactly as asked (+2), ended cleanly (+5)");

    const bad = grantFor(gate, KABIR);
    assertDenied(() => gate.use(KABIR, { credential: bad.credential, resourceId: SENTINEL, purpose: "fine-tuning" }), "R4");
    gate.revoke(RISK, bad.id, "misuse");
    const s = gate.score(KABIR);
    assert.equal(s.score, 50 + 2 - 3 - 20, "approved as asked (+2), denied use (−3), revoked (−20)");
    assert.ok(s.factors.some((f) => f.reason.includes("emergency-revoked")));
    assert.ok(clean);
  });

  test("a low score and a high score produce exactly the same review requirements and grant", () => {
    const { gate, clock } = makeGate();
    // Drive Kabir's score down; Maya stays at a clean history.
    for (let i = 0; i < 3; i++) {
      const g = grantFor(gate, KABIR);
      gate.revoke(RISK, g.id, "demo misuse");
    }
    for (let i = 0; i < 3; i++) grantFor(gate, MAYA);
    clock.advance(8 * DAY);
    assert.ok(gate.score(KABIR).score < 20);
    assert.ok(gate.score(MAYA).score > 60);

    const outcome = (sub) => {
      const req = request(gate, sub);
      approve(gate, req.id, "manager", GUIDE);
      approve(gate, req.id, "risk", RISK);
      const pending = gate.listRequests().find((r) => r.id === req.id);
      const grant = approve(gate, req.id, "owner", IRA).grant;
      return { pendingStatus: pending.status, purposes: [...grant.purposes], duration: grant.expiresAt - grant.startsAt, controls: [...grant.controls] };
    };
    assert.deepEqual(outcome(KABIR), outcome(MAYA));
  });
});

describe("T11 reviewer dashboards", () => {
  test("each dashboard needs its role, and a refused open is logged", () => {
    const { gate } = makeGate();
    assertDenied(() => gate.dashboard(MAYA, "manager"), "R11");
    assertDenied(() => gate.dashboard(GUIDE, "risk"), "R11");
    assertDenied(() => gate.dashboard(RISK, "owner"), "R11");
    const last = gate.history().at(-1);
    assert.equal(last.action, "dashboard.open");
    assert.equal(last.allowed, false);
    assert.equal(last.rule, "R11");
    assert.throws(() => gate.dashboard(GUIDE, "admin"), /not found/);
    assert.equal(gate.dashboard(GUIDE, "manager").role, "manager");
  });

  test("a manager sees what they can act on, apart from their own requests and ones where they hold another slot", () => {
    const { gate, state } = makeGate();
    state.users[GUIDE].roles.push("requester");
    const fromMaya = request(gate, MAYA);
    const fromGuide = request(gate, GUIDE);
    const ids = (list) => list.map((r) => r.id);

    approve(gate, fromMaya.id, "risk", NEEL);
    const neel = gate.dashboard(NEEL, "manager");
    assert.ok(ids(neel.otherSlot).includes(fromMaya.id), "Neel already filled the risk slot (R2)");
    assert.ok(!ids(neel.actionable).includes(fromMaya.id));

    const guide = gate.dashboard(GUIDE, "manager");
    assert.deepEqual(ids(guide.actionable), [fromMaya.id]);
    assert.deepEqual(ids(guide.yours), [fromGuide.id], "own requests are set apart (R1)");

    approve(gate, fromMaya.id, "manager", GUIDE);
    const after = gate.dashboard(GUIDE, "manager");
    assert.deepEqual(ids(after.actionable), []);
    assert.deepEqual(ids(after.decidedByYou), [fromMaya.id]);
  });

  test("a resource owner sees only the resources they own, with GPU use", () => {
    const { gate, state } = makeGate();
    state.users[NEEL].roles.push("owner");
    state.resources.find((r) => r.id === H100).ownerSubs.push(NEEL);
    const model = request(gate, MAYA);
    const gpus = request(gate, KABIR, { resourceId: H100, purposes: ["evaluation"], durationDays: 1, controls: [], gpuCount: 4 });

    const neel = gate.dashboard(NEEL, "owner");
    assert.deepEqual(neel.actionable.map((r) => r.id), [gpus.id]);
    assert.deepEqual(neel.resources.map((r) => r.id), [H100]);
    assert.deepEqual(gate.dashboard(IRA, "owner").actionable.map((r) => r.id), [gpus.id, model.id]);

    approve(gate, gpus.id, "manager", GUIDE);
    approve(gate, gpus.id, "risk", RISK);
    const grant = approve(gate, gpus.id, "owner", NEEL).grant;
    gate.submitJob(KABIR, { credential: grant.credential, gpus: 3, purpose: "evaluation", image: "netra/eval-harness:1.0", hours: 2 });
    const pool = gate.dashboard(NEEL, "owner").resources[0];
    assert.equal(pool.liveGrants, 1);
    assert.equal(pool.gpusGranted, 4);
    assert.equal(pool.gpusRunning, 3);
    assert.equal(gate.dashboard(NEEL, "owner").activeGrants[0].credential, null, "owners never see the holder's credential");
  });

  test("a risk reviewer sees live grants, running jobs and recent denials", () => {
    const { gate } = makeGate();
    const grant = grantFor(gate);
    assertDenied(() => gate.use(MAYA, { credential: grant.credential, resourceId: SENTINEL, purpose: "fine-tuning" }), "R4");
    const risk = gate.dashboard(RISK, "risk");
    assert.deepEqual(risk.activeGrants.map((g) => g.id), [grant.id]);
    assert.equal(risk.activeGrants[0].credential, null);
    assert.equal(risk.recentDenials[0].rule, "R4");
    assert.ok(!JSON.stringify(risk).includes(grant.credential), "no credentials anywhere on the risk dashboard");
    gate.revoke(RISK, grant.id, "incident");
    assert.deepEqual(gate.dashboard(RISK, "risk").activeGrants, []);
  });
});

describe("New users", () => {
  test("a first-time NamoID user can request access but holds no reviewer role", () => {
    const { gate } = makeGate();
    const user = gate.upsertUser({ sub: "namoid|new-person", name: "New Person" });
    assert.deepEqual(user.roles, ["requester"]);
    const created = gate.createRequest("namoid|new-person", { resourceId: SENTINEL, purposes: ["evaluation"], durationDays: 1, controls: [], justification: "first ask" });
    assert.equal(created.allowed, true);
    for (const role of ["manager", "risk", "owner"]) assertDenied(() => gate.dashboard("namoid|new-person", role), "R11");
    assertDenied(() => gate.review("namoid|new-person", created.request.id, { slot: "manager", decision: "approve", reason: "mine" }), "R1");
  });
});

describe("T12 free-text purposes", () => {
  test("any purpose can be written, and use must name an approved one (ignoring case and spacing)", () => {
    const { gate } = makeGate();
    const grant = grantFor(gate, MAYA, { purposes: ["Evaluate jailbreak resistance of the sentinel model"] });
    const use = (purpose) => () => gate.use(MAYA, { credential: grant.credential, resourceId: SENTINEL, purpose, input: "x" });
    const ok = use("  evaluate JAILBREAK   resistance of the sentinel model ")();
    assert.match(ok.receipt, /"Evaluate jailbreak resistance of the sentinel model"/, "the receipt quotes the approved wording");
    assertDenied(use("Fine-tune a chatbot on its outputs"), "R4");
    assertDenied(use(""), "R4");
  });

  test("narrowing can drop a written purpose but never add or reword one", () => {
    const { gate } = makeGate();
    const req = request(gate, MAYA, { purposes: ["Benchmark latency", "Red-team prompts"] });
    assertDenied(
      () => gate.review(RISK, req.id, { slot: "risk", decision: "narrow", reason: "x", narrowTo: { purposes: ["Benchmark latency", "Something new"] } }),
      "R3",
    );
    gate.review(RISK, req.id, { slot: "risk", decision: "narrow", reason: "latency only", narrowTo: { purposes: ["benchmark LATENCY"] } });
    approve(gate, req.id, "manager", GUIDE);
    const grant = approve(gate, req.id, "owner", IRA).grant;
    assert.deepEqual(grant.purposes, ["Benchmark latency"], "the original wording survives the narrowing");
    assertDenied(() => gate.use(MAYA, { credential: grant.credential, resourceId: SENTINEL, purpose: "Red-team prompts" }), "R4");
  });
});

describe("T13 who can see what", () => {
  test("a requester sees only their own requests, grants, jobs and history", () => {
    const { gate } = makeGate();
    const mine = grantFor(gate, MAYA);
    const theirs = grantFor(gate, KABIR, { resourceId: H100, purposes: ["Benchmark"], durationDays: 1, controls: [], gpuCount: 2 });
    gate.submitJob(KABIR, { credential: theirs.credential, gpus: 1, purpose: "Benchmark", image: "netra/eval-harness:1.0", hours: 1 });
    assert.deepEqual(gate.listGrants(MAYA).map((g) => g.id), [mine.id]);
    assert.ok(gate.listRequests(MAYA).every((r) => r.requesterSub === MAYA));
    assert.deepEqual(gate.listJobs(MAYA), []);
    const history = gate.history({}, MAYA);
    assert.ok(history.length > 0);
    assert.ok(history.every((e) => e.actorSub === MAYA || e.grantId === mine.id || e.requestId === mine.requestId), "nothing about Kabir");
    assert.ok(!JSON.stringify(gate.history({}, MAYA)).includes(theirs.id));
  });

  test("reviewers see what their role needs; credentials stay with the holder", () => {
    const { gate, state } = makeGate();
    state.users[NEEL].roles = ["requester", "owner"];
    state.resources.find((r) => r.id === H100).ownerSubs.push(NEEL);
    const model = grantFor(gate, MAYA);
    const gpus = grantFor(gate, KABIR, { resourceId: H100, purposes: ["Benchmark"], durationDays: 1, controls: [], gpuCount: 2 });
    assert.deepEqual(gate.listGrants(NEEL).map((g) => g.id), [gpus.id], "an owner sees only grants on resources they own");
    assert.equal(gate.listGrants(RISK).length, 2, "risk sees everything");
    assert.equal(gate.listGrants(GUIDE).length, 2, "the manager sees grants of requests they decided");
    for (const viewer of [RISK, GUIDE, NEEL]) assert.ok(gate.listGrants(viewer).every((g) => g.credential === null));
    assert.match(gate.listGrants(MAYA)[0].credential, /^mock_key_/);
    assert.ok(model);
  });
});

describe("T14 role directory", () => {
  const directory = parseDirectory({ "lead@example.test": ["manager"], "ops@example.test": { roles: ["owner", "admin"], owns: [H100] } });

  test("roles come from the directory, matched on a NamoID-verified email only", () => {
    const { state } = makeGate();
    const gate = createGate({ state, clock: fixedClock(), directory });
    assert.deepEqual(gate.upsertUser({ sub: "n|1", name: "Lead", email: "LEAD@example.test", emailVerified: false }).roles, ["requester"], "unverified email: no roles");
    assert.deepEqual(gate.upsertUser({ sub: "n|1", name: "Lead", email: "lead@example.test", emailVerified: true }).roles, ["requester", "manager"]);
    const ops = gate.upsertUser({ sub: "n|2", name: "Ops", email: "ops@example.test", emailVerified: true });
    assert.deepEqual(ops.roles, ["requester", "owner", "admin"]);
    assert.deepEqual(state.resources.filter((r) => r.ownerSubs.includes("n|2")).map((r) => r.id), [H100], "owns only what the directory says");
    assert.equal(gate.history().filter((e) => e.action === "roles.directory").length, 2, "role changes are logged");
  });

  test("being taken out of the directory removes the roles", () => {
    const { state } = makeGate();
    createGate({ state, clock: fixedClock(), directory }).upsertUser({ sub: "n|1", name: "Lead", email: "lead@example.test", emailVerified: true });
    const later = createGate({ state, clock: fixedClock(), directory: parseDirectory({}) });
    assert.deepEqual(later.upsertUser({ sub: "n|1", name: "Lead", email: "lead@example.test", emailVerified: true }).roles, ["requester"]);
  });

  test("a directory with an unknown role is refused at startup", () => {
    assert.throws(() => parseDirectory({ "x@example.test": ["superuser"] }), /unknown role/);
  });
});
