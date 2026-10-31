// Requester confidence score: advisory context for reviewers only.
// Built only from behaviour inside this app. The engine never reads it when deciding anything.
const HOUR = 60 * 60 * 1000;

export const SCORE_WEIGHTS = Object.freeze({
  start: 50,
  cleanGrant: 5,
  approvedAsAsked: 2,
  accurateCompute: 3,
  overAskedCompute: -3,
  deniedUse: -3,
  revoked: -20,
});

const USE_ACTIONS = new Set(["resource.use", "job.submit"]);

export function computeScore(state, sub, t) {
  const factors = [];
  const grants = state.grants.filter((g) => g.holderSub === sub);

  for (const event of state.audit) {
    if (event.actorSub === sub && USE_ACTIONS.has(event.action) && !event.allowed && event.grantId) {
      factors.push({ delta: SCORE_WEIGHTS.deniedUse, reason: `Denied use attempt on ${event.grantId} (${event.rule})`, at: event.at });
    }
  }

  // Asking for what you actually need: approved with no reviewer having to narrow it.
  for (const request of state.requests) {
    if (request.requesterSub !== sub || request.status !== "approved") continue;
    const narrowed = Object.values(request.reviews).some((r) => r?.decision === "narrow");
    if (!narrowed) {
      factors.push({ delta: SCORE_WEIGHTS.approvedAsAsked, reason: `${request.id} was approved exactly as asked`, at: new Date(request.createdAt).toISOString() });
    }
  }

  for (const grant of grants) {
    if (grant.revokedAt != null) {
      factors.push({ delta: SCORE_WEIGHTS.revoked, reason: `${grant.id} was emergency-revoked`, at: new Date(grant.revokedAt).toISOString() });
      continue;
    }
    if (t < grant.expiresAt) continue;

    const violations = state.audit.some((e) => e.grantId === grant.id && e.actorSub === sub && !e.allowed);
    if (!violations) {
      factors.push({ delta: SCORE_WEIGHTS.cleanGrant, reason: `${grant.id} ended cleanly`, at: new Date(grant.expiresAt).toISOString() });
    }

    if (grant.gpuCount) {
      const approved = grant.gpuCount * ((grant.expiresAt - grant.startsAt) / HOUR);
      const used = state.jobs
        .filter((j) => j.grantId === grant.id)
        .reduce((sum, j) => {
          const end = Math.min(j.startedAt + j.hours * HOUR, j.killedAt ?? Infinity, grant.expiresAt);
          return sum + j.gpus * Math.max(0, end - j.startedAt) / HOUR;
        }, 0);
      const ratio = approved > 0 ? used / approved : 0;
      if (ratio >= 0.5) {
        factors.push({ delta: SCORE_WEIGHTS.accurateCompute, reason: `${grant.id}: used ${Math.round(ratio * 100)}% of approved GPU-hours`, at: new Date(grant.expiresAt).toISOString() });
      } else if (ratio < 0.2) {
        factors.push({ delta: SCORE_WEIGHTS.overAskedCompute, reason: `${grant.id}: used only ${Math.round(ratio * 100)}% of approved GPU-hours`, at: new Date(grant.expiresAt).toISOString() });
      }
    }
  }

  const raw = factors.reduce((sum, f) => sum + f.delta, SCORE_WEIGHTS.start);
  return {
    sub,
    score: Math.max(0, Math.min(100, raw)),
    label: factors.length ? null : "No history yet",
    factors,
    advisory: "Advisory. Based only on history in this app. Reviewers decide.",
  };
}
