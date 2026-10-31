// The rule catalogue. Receipts, the break-it panel, and the tests all cite these ids.
export const RULES = Object.freeze({
  R0: { title: "Must be signed in via NamoID Hosted Auth", status: 401 },
  R1: { title: "You can't review your own request", status: 403 },
  R2: { title: "One person, one slot per request; each slot is decided once", status: 403 },
  R3: { title: "Narrowing can only reduce scope", status: 422 },
  R4: { title: "Use must match an approved purpose", status: 403 },
  R5: { title: "GPU count can't exceed the grant", status: 403 },
  R6: { title: "Grant must be active (started and not expired)", status: 403 },
  R7: { title: "Revoked grants never work again", status: 403 },
  R8: { title: "Expiry is immutable; more time needs a new, fully reviewed request", status: 405 },
  R9: { title: "Only the resource's owner fills the owner slot", status: 403 },
  R10: { title: "Images must be on the allowlist when approved-images-only is set", status: 403 },
  R11: { title: "This action needs the matching role", status: 403 },
  R12: { title: "Requests and decisions must be complete and within the resource's limits", status: 422 },
  R13: { title: "A grant only works for its holder and its resource", status: 403 },
});

export const NOT_SAFE = "Authorized under these conditions. This does not mean the use is safe.";

export class Denied extends Error {
  constructor(rule, receipt, detail = {}) {
    super(receipt);
    this.rule = rule;
    this.receipt = receipt;
    this.detail = detail;
    this.status = RULES[rule]?.status ?? 403;
  }

  toJSON() {
    return { allowed: false, rule: this.rule, ruleTitle: RULES[this.rule]?.title, receipt: this.receipt };
  }
}

export class NotFound extends Error {
  constructor(what) {
    super(`${what} not found`);
    this.status = 404;
  }
}

export function deny(rule, receipt, detail) {
  throw new Denied(rule, `Denied (${rule}): ${receipt}`, detail);
}
