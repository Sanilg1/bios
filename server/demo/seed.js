// Demo data: ten days of fictional activity, played through the real policy engine so every
// receipt, denial, grant status and score is genuine. Runs only in DEMO_MODE on an empty gate.
//
// It moves the clock back ten days, plays the story forward, then puts the clock back exactly,
// so grants that "ended last week" really are expired and Arjun's job really is running now.
//
// End state, from the reviewers' point of view (the three slots are decided in parallel):
//   waiting on manager: Maya's extension, Priya's sentinel request
//   waiting on risk:    those two, plus Kabir's second (smaller) H100 request
//   waiting on owner:   those three, plus Maya's dataset request
//   active:             Priya on summarizer-mock, Arjun on 4 mock H100s with a running job
//   expired:            Maya's narrowed sentinel grant · revoked: Kabir's first H100 grant
//   rejected:           Arjun's 30-day claims-data request
import { DAY, HOUR } from "../policy/engine.js";
import { Denied } from "../policy/rules.js";

const MAYA = "persona:maya";
const KABIR = "persona:kabir";
const PRIYA = "persona:priya";
const ARJUN = "persona:arjun";
const GUIDE = "persona:guide";
const RISK = "persona:risk";
const IRA = "persona:ira";

const SENTINEL = "model:sentinel-eval-mock";
const SUMMARIZER = "model:summarizer-mock";
const TICKETS = "dataset:synthetic-support-tickets";
const CLAIMS = "dataset:synthetic-claims-sample";
const H100 = "compute:h100-pool-mock";

export function seedDemoData(gate, clock) {
  let moved = 0;
  const step = (ms) => {
    clock.advance(ms);
    moved += ms;
  };
  // Denials are part of the story: they become receipts in the history and lower scores.
  const attempt = (fn) => {
    try {
      return fn();
    } catch (error) {
      if (!(error instanceof Denied)) throw error;
      return null;
    }
  };
  const ask = (sub, body) => gate.createRequest(sub, body).request;
  const decide = (sub, id, slot, decision, reason, narrowTo) => gate.review(sub, id, { slot, decision, reason, ...(narrowTo ? { narrowTo } : {}) });
  const approveAll = (id, reasons) => {
    decide(GUIDE, id, "manager", "approve", reasons[0]);
    decide(RISK, id, "risk", "approve", reasons[1]);
    return decide(IRA, id, "owner", "approve", reasons[2]).grant;
  };

  try {
    step(-10 * DAY);

    // Day 0. Maya asks for two weeks, tries to approve it herself, and is narrowed to one week.
    const maya = ask(MAYA, {
      resourceId: SENTINEL,
      purposes: ["evaluation", "internal-research"],
      durationDays: 14,
      controls: [],
      justification: "Two-week evaluation of the sensitive mock model for my lab report",
    });
    attempt(() => decide(MAYA, maya.id, "manager", "approve", "I need this soon"));
    decide(GUIDE, maya.id, "manager", "approve", "Evaluation is in the project plan");
    decide(RISK, maya.id, "risk", "narrow", "Evaluation only, one week, no export", { purposes: ["evaluation"], durationDays: 7, controls: ["no-export"] });
    const mayaGrant = decide(IRA, maya.id, "owner", "approve", "Fine with the narrowed scope").grant;
    step(2 * HOUR);
    gate.use(MAYA, { credential: mayaGrant.credential, resourceId: SENTINEL, purpose: "evaluation", input: "fake transcript 1" });
    attempt(() => gate.use(MAYA, { credential: mayaGrant.credential, resourceId: SENTINEL, purpose: "internal-research", input: "fake" }));
    attempt(() => gate.attemptExpiryChange(MAYA, mayaGrant.id));

    // Day 1. Kabir asks for all 8 mock H100s; he gets 2 for 3 days, misbehaves, and is revoked.
    step(1 * DAY - 2 * HOUR);
    const kabir = ask(KABIR, {
      resourceId: H100,
      purposes: ["fine-tuning"],
      durationDays: 7,
      controls: [],
      gpuCount: 8,
      justification: "LoRA fine-tune for my final-year project",
    });
    decide(GUIDE, kabir.id, "manager", "approve", "Supervised thesis work");
    decide(RISK, kabir.id, "risk", "narrow", "Start with 2 GPUs for 3 days, no internet from jobs", {
      gpuCount: 2,
      durationDays: 3,
      controls: ["no-network-egress", "approved-images-only"],
    });
    const kabirGrant = decide(IRA, kabir.id, "owner", "approve", "Capacity available this week").grant;
    attempt(() => gate.submitJob(KABIR, { credential: kabirGrant.credential, gpus: 4, purpose: "fine-tuning", image: "netra/finetune-lora:1.0", hours: 6 }));
    attempt(() => gate.submitJob(KABIR, { credential: kabirGrant.credential, gpus: 2, purpose: "fine-tuning", image: "random/crypto-miner:latest", hours: 6 }));
    gate.submitJob(KABIR, { credential: kabirGrant.credential, gpus: 2, purpose: "fine-tuning", image: "netra/finetune-lora:1.0", hours: 12 });
    step(3 * HOUR);
    gate.revoke(RISK, kabirGrant.id, "Job tried to reach the internet (demo scenario)");
    attempt(() => gate.submitJob(KABIR, { credential: kabirGrant.credential, gpus: 1, purpose: "fine-tuning", image: "netra/finetune-lora:1.0", hours: 1 }));

    // Day 2. Arjun asks for a month of claims data; risk rejects it.
    step(1 * DAY - 3 * HOUR);
    const claims = ask(ARJUN, {
      resourceId: CLAIMS,
      purposes: ["internal-research"],
      durationDays: 30,
      controls: [],
      justification: "Explore claim patterns for a fraud-detection idea",
    });
    decide(GUIDE, claims.id, "manager", "approve", "Relevant to his team's roadmap");
    decide(RISK, claims.id, "risk", "reject", "30 days of claims data is too long. Ask again for 7 days with no-export.");

    // Day 8. Maya's grant ended on day 7. Her late call is refused; she asks for 3 more days properly.
    step(6 * DAY);
    attempt(() => gate.use(MAYA, { credential: mayaGrant.credential, resourceId: SENTINEL, purpose: "evaluation", input: "one more run" }));
    ask(MAYA, {
      resourceId: SENTINEL,
      purposes: ["evaluation"],
      durationDays: 3,
      controls: ["no-export"],
      justification: "Three more days to finish the evaluation report",
      extendsGrantId: mayaGrant.id,
    });
    step(2 * HOUR);
    const tickets = ask(MAYA, {
      resourceId: TICKETS,
      purposes: ["internal-research"],
      durationDays: 10,
      controls: ["no-export", "logging-required"],
      justification: "Label support-ticket intents for the evaluation set",
    });
    decide(GUIDE, tickets.id, "manager", "approve", "Supports the same report");
    decide(RISK, tickets.id, "risk", "approve", "Synthetic data, export blocked, logging on");

    // Day 9. Priya gets the summarizer for a demo and uses it.
    step(1 * DAY - 2 * HOUR);
    const priya = ask(PRIYA, {
      resourceId: SUMMARIZER,
      purposes: ["prototype-demo"],
      durationDays: 5,
      controls: ["rate-limit", "output-watermark"],
      justification: "Demo of a meeting-notes summarizer at the lab open day",
    });
    const priyaGrant = approveAll(priya.id, ["Open-day demo is approved", "Watermarked, rate-limited outputs", "Summarizer has spare capacity"]);
    step(1 * HOUR);
    gate.use(PRIYA, { credential: priyaGrant.credential, resourceId: SUMMARIZER, purpose: "prototype-demo", input: "fake meeting notes" });

    // Day 9, evening. Kabir tries again with a much smaller ask; his score now shows the revocation.
    step(10 * HOUR);
    const kabirAgain = ask(KABIR, {
      resourceId: H100,
      purposes: ["evaluation"],
      durationDays: 2,
      controls: ["no-network-egress", "approved-images-only"],
      gpuCount: 2,
      justification: "Evaluate last week's checkpoint, offline, approved image only",
    });
    decide(GUIDE, kabirAgain.id, "manager", "approve", "Smaller, offline ask after last week's revoke");

    // Today, three hours ago. Arjun gets 4 mock H100s for a day; his job is running now.
    step(10 * HOUR);
    const arjun = ask(ARJUN, {
      resourceId: H100,
      purposes: ["evaluation"],
      durationDays: 1,
      controls: ["approved-images-only"],
      gpuCount: 4,
      justification: "Benchmark the eval harness on 4 GPUs",
    });
    const arjunGrant = approveAll(arjun.id, ["Benchmarking is in the sprint", "Approved image only", "4 of 8 GPUs free today"]);
    step(2 * HOUR);
    gate.submitJob(ARJUN, { credential: arjunGrant.credential, gpus: 4, purpose: "evaluation", image: "netra/eval-harness:1.0", hours: 6 });

    // Thirty minutes ago. Priya asks for the sentinel model; nobody has looked at it yet.
    step(30 * 60 * 1000);
    ask(PRIYA, {
      resourceId: SENTINEL,
      purposes: ["evaluation"],
      durationDays: 7,
      controls: ["no-export"],
      justification: "Compare the summarizer's safety filter against the sentinel model",
    });
  } finally {
    // Put the clock back exactly where it was, so "now" is real time again.
    clock.advance(-moved);
  }
}
