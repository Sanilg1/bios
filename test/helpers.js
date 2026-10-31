import { createGate, DAY, fixedClock } from "../server/policy/engine.js";
import { Denied } from "../server/policy/rules.js";
import { seedState } from "../server/store.js";
import assert from "node:assert/strict";

export const MAYA = "persona:maya";
export const KABIR = "persona:kabir";
export const GUIDE = "persona:guide";
export const RISK = "persona:risk";
export const IRA = "persona:ira";
export const NEEL = "persona:neel";
export const SENTINEL = "model:sentinel-eval-mock";
export const H100 = "compute:h100-pool-mock";
export { DAY };

export function makeGate() {
  const state = seedState({ withPersonas: true });
  const clock = fixedClock();
  let n = 0;
  const gate = createGate({ state, clock, newSecret: () => `test${++n}` });
  return { gate, clock, state };
}

export function request(gate, sub = MAYA, overrides = {}) {
  return gate.createRequest(sub, {
    resourceId: SENTINEL,
    purposes: ["evaluation"],
    durationDays: 7,
    controls: ["no-export"],
    justification: "Two-week evaluation",
    ...overrides,
  }).request;
}

export function approve(gate, requestId, slot, sub) {
  return gate.review(sub, requestId, { slot, decision: "approve", reason: "ok" });
}

export function approveAll(gate, requestId) {
  approve(gate, requestId, "manager", GUIDE);
  approve(gate, requestId, "risk", RISK);
  return approve(gate, requestId, "owner", IRA).grant;
}

export function grantFor(gate, sub = MAYA, overrides = {}) {
  return approveAll(gate, request(gate, sub, overrides).id);
}

// Asserts that fn throws a Denied for the given rule, with a receipt naming it.
export function assertDenied(fn, rule) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof Denied, `expected Denied ${rule}, got ${error}`);
    assert.equal(error.rule, rule, `expected ${rule}, got ${error.rule}: ${error.receipt}`);
    assert.match(error.receipt, new RegExp(`^Denied \\(${rule}\\): .+`));
    return error;
  }
  assert.fail(`expected Denied ${rule}, but the action was allowed`);
}
