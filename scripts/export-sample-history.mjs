// Plays the demo story (Maya + Kabir) through the real policy engine on a fixed clock
// and writes the resulting audit trail to samples/access-history.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { createGate, DAY, fixedClock, HOUR } from "../server/policy/engine.js";
import { Denied } from "../server/policy/rules.js";
import { seedState } from "../server/store.js";

const state = seedState({ withPersonas: true });
const clock = fixedClock(Date.UTC(2026, 9, 31, 9, 0, 0));
let n = 0;
const gate = createGate({ state, clock, newSecret: () => `sample${String(++n).padStart(4, "0")}` });
const attempt = (fn) => {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof Denied)) throw error;
    return null;
  }
};

const MAYA = "persona:maya";
const KABIR = "persona:kabir";
const GUIDE = "persona:guide";
const RISK = "persona:risk";
const IRA = "persona:ira";

// Act 1: Maya asks for two weeks; risk narrows to one week, evaluation only.
gate.setRoles(MAYA, MAYA, ["requester", "manager"]);
const maya = gate.createRequest(MAYA, {
  resourceId: "model:sentinel-eval-mock",
  purposes: ["evaluation", "internal-research"],
  durationDays: 14,
  controls: [],
  justification: "Two-week evaluation of the sensitive mock model",
}).request;
attempt(() => gate.review(MAYA, maya.id, { slot: "manager", decision: "approve", reason: "I need this" }));
gate.review(GUIDE, maya.id, { slot: "manager", decision: "approve", reason: "Evaluation is part of the project plan" });
gate.review(RISK, maya.id, {
  slot: "risk",
  decision: "narrow",
  reason: "Evaluation only for one week, no export",
  narrowTo: { purposes: ["evaluation"], durationDays: 7, controls: ["no-export"] },
});
const mayaGrant = gate.review(IRA, maya.id, { slot: "owner", decision: "approve", reason: "Model owner OK with narrowed scope" }).grant;
clock.advance(2 * HOUR);
gate.use(MAYA, { credential: mayaGrant.credential, resourceId: mayaGrant.resourceId, purpose: "evaluation", input: "fake transcript 1" });
attempt(() => gate.use(MAYA, { credential: mayaGrant.credential, resourceId: mayaGrant.resourceId, purpose: "internal-research", input: "fake" }));
attempt(() => gate.attemptExpiryChange(MAYA, mayaGrant.id));
clock.advance(8 * DAY);
attempt(() => gate.use(MAYA, { credential: mayaGrant.credential, resourceId: mayaGrant.resourceId, purpose: "evaluation", input: "late" }));
gate.createRequest(MAYA, {
  resourceId: "model:sentinel-eval-mock",
  purposes: ["evaluation"],
  durationDays: 3,
  controls: ["no-export"],
  justification: "Three more days to finish the evaluation report",
  extendsGrantId: mayaGrant.id,
});

// Act 2: Kabir asks for 8 mock H100s; narrowed to 2 GPUs, 3 days, no network; then emergency revoke.
const kabir = gate.createRequest(KABIR, {
  resourceId: "compute:h100-pool-mock",
  purposes: ["fine-tuning"],
  durationDays: 7,
  controls: [],
  gpuCount: 8,
  justification: "LoRA fine-tune for my final-year project",
}).request;
gate.review(GUIDE, kabir.id, { slot: "manager", decision: "approve", reason: "Supervised thesis work" });
gate.review(RISK, kabir.id, {
  slot: "risk",
  decision: "narrow",
  reason: "Start with 2 GPUs for 3 days, no internet from jobs",
  narrowTo: { gpuCount: 2, durationDays: 3, controls: ["no-network-egress", "approved-images-only"] },
});
const kabirGrant = gate.review(IRA, kabir.id, { slot: "owner", decision: "approve", reason: "Capacity available this week" }).grant;
attempt(() => gate.submitJob(KABIR, { credential: kabirGrant.credential, gpus: 4, purpose: "fine-tuning", image: "netra/finetune-lora:1.0", hours: 6 }));
attempt(() => gate.submitJob(KABIR, { credential: kabirGrant.credential, gpus: 2, purpose: "fine-tuning", image: "random/crypto-miner:latest", hours: 6 }));
gate.submitJob(KABIR, { credential: kabirGrant.credential, gpus: 2, purpose: "fine-tuning", image: "netra/finetune-lora:1.0", hours: 12 });
clock.advance(3 * HOUR);
gate.revoke(RISK, kabirGrant.id, "Job tried to reach the internet (demo scenario)");
attempt(() => gate.submitJob(KABIR, { credential: kabirGrant.credential, gpus: 1, purpose: "fine-tuning", image: "netra/finetune-lora:1.0", hours: 1 }));

const out = {
  note: "Sample access history from Team Netra's Responsible AI Access Gate. All resources, people, credentials and outputs are mock. Approval ≠ safety.",
  generatedBy: "npm run sample-history (fixed clock starting 2026-10-31T09:00:00Z)",
  scores: { maya: gate.score(MAYA), kabir: gate.score(KABIR) },
  events: gate.history(),
};
mkdirSync("samples", { recursive: true });
writeFileSync("samples/access-history.json", `${JSON.stringify(out, null, 2)}\n`);
const denied = out.events.filter((e) => !e.allowed).length;
console.log(`Wrote samples/access-history.json: ${out.events.length} events (${denied} denied).`);
