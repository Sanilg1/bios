// "Try to break it" attacks. Each one sets up a scenario through the real HTTP API with real
// personas (role setup goes straight to the gate), then performs one forbidden action. The panel runs them; the tests (T10) run the same list.
const MAYA = "persona:maya";
const KABIR = "persona:kabir";
const GUIDE = "persona:guide";
const RISK = "persona:risk";
const IRA = "persona:ira";
const NEEL = "persona:neel";
const OUTSIDER_OWNER = "persona:outsider-owner";

const SENTINEL = "model:sentinel-eval-mock";
const H100 = "compute:h100-pool-mock";

async function submit(api, as, body) {
  const res = await api.as(as).post("/api/requests", {
    resourceId: SENTINEL,
    purposes: ["evaluation"],
    durationDays: 7,
    controls: ["no-export"],
    justification: "Two-week evaluation of the mock model",
    ...body,
  });
  return res.body.request;
}

async function approveAll(api, requestId, slots = { manager: GUIDE, risk: RISK, owner: IRA }) {
  let last;
  for (const [slot, sub] of Object.entries(slots)) {
    last = await api.as(sub).post(`/api/requests/${requestId}/reviews`, { slot, decision: "approve", reason: "Looks fine for the demo" });
  }
  return last.body.grant;
}

async function grantFor(api, as, body) {
  const request = await submit(api, as, body);
  return approveAll(api, request.id);
}

export const ATTACKS = [
  {
    id: "self-approve",
    rule: "R1",
    title: "Approve your own request",
    tries: "Neel holds the manager role, submits a request, then tries to approve it as manager.",
    async run(api) {
      api.setRoles(NEEL, ["requester", "manager", "risk"]);
      const request = await submit(api, NEEL);
      return api.as(NEEL).post(`/api/requests/${request.id}/reviews`, { slot: "manager", decision: "approve", reason: "I trust myself" });
    },
  },
  {
    id: "two-slots",
    rule: "R2",
    title: "Fill two reviewer slots",
    tries: "Neel (manager + risk) approves Maya's request as manager, then tries to approve it again as risk reviewer.",
    async run(api) {
      const request = await submit(api, MAYA);
      await api.as(NEEL).post(`/api/requests/${request.id}/reviews`, { slot: "manager", decision: "approve", reason: "Business need is clear" });
      return api.as(NEEL).post(`/api/requests/${request.id}/reviews`, { slot: "risk", decision: "approve", reason: "Also fine on risk" });
    },
  },
  {
    id: "widen-while-narrowing",
    rule: "R3",
    title: "Widen scope while 'narrowing'",
    tries: "The risk reviewer submits a 'narrow' decision that actually adds a purpose and extends the duration.",
    async run(api) {
      const request = await submit(api, MAYA);
      return api.as(RISK).post(`/api/requests/${request.id}/reviews`, {
        slot: "risk",
        decision: "narrow",
        reason: "Sneaky widening",
        narrowTo: { purposes: ["evaluation", "internal-research"], durationDays: 30 },
      });
    },
  },
  {
    id: "wrong-purpose",
    rule: "R4",
    title: "Use the grant for another purpose",
    tries: "Maya has an evaluation-only grant and calls the model for internal-research.",
    async run(api) {
      const grant = await grantFor(api, MAYA);
      const own = await api.as(MAYA).get("/api/grants");
      const credential = own.body.find((g) => g.id === grant.id).credential;
      return api.as(MAYA).post("/api/use", { credential, resourceId: SENTINEL, purpose: "internal-research", input: "score this" });
    },
  },
  {
    id: "too-many-gpus",
    rule: "R5",
    title: "Run a job on more GPUs than granted",
    tries: "Kabir's H100 grant was narrowed from 8 to 2 GPUs. He submits a 4-GPU job.",
    async run(api) {
      const request = await submit(api, KABIR, { resourceId: H100, purposes: ["fine-tuning"], durationDays: 7, controls: [], gpuCount: 8, justification: "Fine-tune a small model for my thesis" });
      await api.as(GUIDE).post(`/api/requests/${request.id}/reviews`, { slot: "manager", decision: "approve", reason: "Thesis work" });
      await api.as(RISK).post(`/api/requests/${request.id}/reviews`, { slot: "risk", decision: "narrow", reason: "Start small", narrowTo: { gpuCount: 2, durationDays: 3, controls: ["no-network-egress"] } });
      await api.as(IRA).post(`/api/requests/${request.id}/reviews`, { slot: "owner", decision: "approve", reason: "Capacity available" });
      const own = await api.as(KABIR).get("/api/grants");
      const credential = own.body[0].credential;
      return api.as(KABIR).post("/api/jobs", { credential, gpus: 4, purpose: "fine-tuning", image: "netra/finetune-lora:1.0", hours: 6 });
    },
  },
  {
    id: "after-expiry",
    rule: "R6",
    title: "Use the grant after it expires",
    tries: "Maya's 7-day grant is used on day 8 (sandbox clock moved forward).",
    async run(api) {
      const grant = await grantFor(api, MAYA);
      const own = await api.as(MAYA).get("/api/grants");
      const credential = own.body.find((g) => g.id === grant.id).credential;
      api.advanceDays(8);
      return api.as(MAYA).post("/api/use", { credential, resourceId: SENTINEL, purpose: "evaluation", input: "still here?" });
    },
  },
  {
    id: "after-revoke",
    rule: "R7",
    title: "Use the grant after emergency revocation",
    tries: "The risk reviewer revokes Maya's grant; Maya immediately tries to use it.",
    async run(api) {
      const grant = await grantFor(api, MAYA);
      const own = await api.as(MAYA).get("/api/grants");
      const credential = own.body.find((g) => g.id === grant.id).credential;
      await api.as(RISK).post(`/api/grants/${grant.id}/revoke`, { reason: "Suspicious usage pattern (demo)" });
      return api.as(MAYA).post("/api/use", { credential, resourceId: SENTINEL, purpose: "evaluation", input: "one more call" });
    },
  },
  {
    id: "silent-extension",
    rule: "R8",
    title: "Quietly extend a grant",
    tries: "Maya sends PATCH /api/grants/:id with a later expiresAt.",
    async run(api) {
      const grant = await grantFor(api, MAYA);
      return api.as(MAYA).patch(`/api/grants/${grant.id}`, { expiresAt: grant.expiresAt + 30 * 24 * 3600 * 1000 });
    },
  },
  {
    id: "non-owner-approves",
    rule: "R9",
    title: "Approve as an owner who doesn't own the resource",
    tries: "A user with the owner role, who owns nothing, tries to fill the owner slot on the Sentinel model.",
    async run(api) {
      api.setRoles(OUTSIDER_OWNER, ["owner"], { ownsNothing: true });
      const request = await submit(api, MAYA);
      return api.as(OUTSIDER_OWNER).post(`/api/requests/${request.id}/reviews`, { slot: "owner", decision: "approve", reason: "I'm an owner too" });
    },
  },
  {
    id: "no-session",
    rule: "R0",
    title: "Call the API without signing in",
    tries: "An anonymous caller lists every grant.",
    async run(api) {
      return api.anonymous().get("/api/grants");
    },
  },
];
