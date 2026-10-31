// The access gate. No Express or NamoID imports: every rule lives here and is unit-testable.
import { randomBytes } from "node:crypto";
import { Denied, NotFound, NOT_SAFE, deny } from "./rules.js";
import {
  APPROVED_IMAGES,
  COMPUTE_ONLY_CONTROLS,
  CONTROLS,
  MAX_DURATION_DAYS,
  PURPOSE_LIMITS,
  ROLES,
  SLOTS,
  SLOT_ROLE,
} from "./catalog.js";
import { computeScore } from "./score.js";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
const MAX_JOB_HOURS = 72;

export function emptyState(resources) {
  return { version: 1, seq: 0, users: {}, resources, requests: [], grants: [], jobs: [], audit: [] };
}

export function createClock(offsetMs = 0) {
  return {
    offsetMs,
    now() {
      return Date.now() + this.offsetMs;
    },
    advance(ms) {
      this.offsetMs += ms;
    },
  };
}

export function fixedClock(start = Date.UTC(2026, 9, 31, 9, 0, 0)) {
  return {
    t: start,
    now() {
      return this.t;
    },
    advance(ms) {
      this.t += ms;
    },
  };
}

// Grant scope and expiry can't be reassigned once issued (R8). Revocation fields stay writable.
function lockGrant(grant) {
  for (const key of ["id", "requestId", "holderSub", "resourceId", "startsAt", "expiresAt", "gpuCount", "credential"]) {
    Object.defineProperty(grant, key, { value: grant[key], writable: false, enumerable: true, configurable: false });
  }
  for (const key of ["purposes", "controls"]) {
    Object.defineProperty(grant, key, { value: Object.freeze([...grant[key]]), writable: false, enumerable: true, configurable: false });
  }
  return grant;
}

export function grantStatus(grant, t) {
  if (grant.revokedAt != null) return "revoked";
  if (t < grant.startsAt) return "scheduled";
  if (t >= grant.expiresAt) return "expired";
  return "active";
}

function jobEnd(job, grant) {
  const planned = job.startedAt + job.hours * HOUR;
  return Math.min(planned, job.killedAt ?? Infinity, grant.expiresAt);
}

export function jobStatus(job, grant, t) {
  if (job.killedAt != null && t >= job.killedAt) return "killed";
  const planned = job.startedAt + job.hours * HOUR;
  if (t >= grant.expiresAt && planned > grant.expiresAt) return "killed";
  if (t >= planned) return "finished";
  return "running";
}

const list = (items) => items.join(", ");
const fmt = (ms) => new Date(ms).toISOString().replace(".000Z", "Z");

// Purposes are free text. Two purposes are the same if they match ignoring case and spacing,
// so "Evaluate  bias" and "evaluate bias" are one purpose, and use must name an approved one.
export function normalizePurpose(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}
export const purposeKey = (text) => normalizePurpose(text).toLowerCase();

// The role directory: who holds which reviewer role, set by the operator (ROLE_DIRECTORY env).
// Keys are NamoID-verified email addresses; values are a list of roles, or { roles, owns }
// where owns lists resource ids (default: every resource) for the owner role.
export function parseDirectory(raw) {
  if (!raw) return new Map();
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const directory = new Map();
  for (const [email, value] of Object.entries(parsed)) {
    const entry = Array.isArray(value) ? { roles: value } : value;
    const roles = [...new Set(["requester", ...(entry.roles ?? [])])];
    const unknown = roles.filter((role) => !ROLES.includes(role));
    if (unknown.length) throw new Error(`ROLE_DIRECTORY: unknown role(s) ${unknown.join(", ")} for ${email}`);
    directory.set(email.trim().toLowerCase(), { roles, owns: entry.owns ?? "*" });
  }
  return directory;
}

export function createGate({ state, clock, onChange = () => {}, newSecret = () => randomBytes(12).toString("hex"), directory = new Map() }) {
  state.grants.forEach(lockGrant);
  state.audit.forEach((event) => Object.freeze(event));

  const now = () => clock.now();
  const nextId = (prefix) => `${prefix}_${++state.seq}`;

  function record(event) {
    // actorName is captured now, so a later profile rename can't rewrite history.
    const actorName = event.actorSub ? nameOf(event.actorSub) : null;
    const entry = Object.freeze({ seq: state.audit.length + 1, at: fmt(now()), actorName, ...event });
    state.audit.push(entry);
    return entry;
  }

  // Runs an action, writes an allowed or denied audit event either way, and persists.
  function guarded(action, actorSub, context, fn) {
    try {
      const result = fn();
      record({ action, actorSub, allowed: true, rule: null, receipt: result.receipt, ...context, ...(result.audit ?? {}) });
      delete result.audit;
      onChange(state);
      return { allowed: true, ...result };
    } catch (error) {
      if (error instanceof Denied) {
        record({ action, actorSub, allowed: false, rule: error.rule, receipt: error.receipt, ...context, ...(error.detail ?? {}) });
        onChange(state);
      }
      throw error;
    }
  }

  // ---------- users and resources ----------

  // Called on every signed-in request. Identity is keyed by NamoID sub; the role directory is
  // matched only on an email NamoID says is verified, and only ever sets roles for that sub.
  function upsertUser({ sub, name, email = null, emailVerified = false }) {
    let user = state.users[sub];
    let changed = false;
    if (!user) {
      // Anyone who signs in may ask for access; asking grants nothing until three other people approve.
      user = state.users[sub] = { sub, name: name || email || sub, email, roles: ["requester"], firstSeenAt: now() };
      record({ action: "user.first-sign-in", actorSub: sub, allowed: true, rule: null, receipt: "First sign-in through NamoID. Can request access; reviewer roles come only from the role directory." });
      changed = true;
    }
    if (name && user.name !== name) {
      user.name = name;
      changed = true;
    }
    if (email && user.email !== email) {
      user.email = email;
      changed = true;
    }
    const entry = email && emailVerified === true ? directory.get(email.trim().toLowerCase()) : null;
    if (entry) changed = applyDirectoryEntry(user, entry) || changed;
    // Taken out of the directory (or email no longer verified): back to requester only.
    else if (user.rolesSource === "directory") changed = applyDirectoryEntry(user, { roles: ["requester"], owns: [] }) || changed;
    if (changed) onChange(state);
    return user;
  }

  function applyDirectoryEntry(user, entry) {
    const before = [...user.roles].sort().join(",");
    const owned = entry.roles.includes("owner") ? (entry.owns === "*" ? state.resources.map((r) => r.id) : entry.owns) : [];
    let ownershipChanged = false;
    for (const resource of state.resources) {
      const owns = resource.ownerSubs.includes(user.sub);
      if (owned.includes(resource.id) && !owns) {
        resource.ownerSubs.push(user.sub);
        ownershipChanged = true;
      }
      if (!owned.includes(resource.id) && owns) {
        resource.ownerSubs = resource.ownerSubs.filter((s) => s !== user.sub);
        ownershipChanged = true;
      }
    }
    const after = [...entry.roles].sort().join(",");
    if (before === after && !ownershipChanged) return false;
    user.roles = [...entry.roles];
    user.rolesSource = entry.roles.length > 1 ? "directory" : null;
    record({
      action: "roles.directory",
      actorSub: user.sub,
      allowed: true,
      rule: null,
      target: user.sub,
      receipt: `Roles from the role directory: [${before || "none"}] → [${after}]${owned.length ? `; owns ${owned.length} resource(s)` : ""}. Separation of duties still applies per request.`,
    });
    return true;
  }

  function getUser(sub) {
    return state.users[sub] ?? null;
  }

  function hasRole(sub, role) {
    return Boolean(state.users[sub]?.roles.includes(role));
  }

  function nameOf(sub) {
    return state.users[sub]?.name ?? sub;
  }

  // Demo-mode role assignment. Audited, and SoD still applies per request.
  function setRoles(actorSub, targetSub, roles) {
    const clean = [...new Set(roles)].filter((role) => ROLES.includes(role));
    const user = state.users[targetSub] ?? upsertUser({ sub: targetSub });
    const before = [...user.roles];
    user.roles = clean;
    for (const resource of state.resources) {
      const owns = resource.ownerSubs.includes(targetSub);
      if (clean.includes("owner") && !owns) resource.ownerSubs.push(targetSub);
      if (!clean.includes("owner") && owns) resource.ownerSubs = resource.ownerSubs.filter((s) => s !== targetSub);
    }
    record({
      action: "roles.set",
      actorSub,
      allowed: true,
      rule: null,
      target: targetSub,
      receipt: `Roles for ${nameOf(targetSub)}: [${list(before) || "none"}] → [${list(clean) || "none"}]. Separation of duties still applies per request.`,
    });
    onChange(state);
    return user;
  }

  function getResource(id) {
    const resource = state.resources.find((r) => r.id === id);
    if (!resource) throw new NotFound(`Resource ${id}`);
    return resource;
  }

  // ---------- requests ----------

  function validateScope(resource, scope) {
    const { purposes, durationDays, controls, gpuCount } = scope;
    if (!Array.isArray(purposes) || purposes.length === 0) deny("R12", "Say what you'll use it for: at least one purpose.");
    if (purposes.length > PURPOSE_LIMITS.maxPurposes) deny("R12", `At most ${PURPOSE_LIMITS.maxPurposes} purposes per request.`);
    for (const purpose of purposes) {
      if (purpose.length < PURPOSE_LIMITS.minLength || purpose.length > PURPOSE_LIMITS.maxLength) {
        deny("R12", `Each purpose must be ${PURPOSE_LIMITS.minLength}–${PURPOSE_LIMITS.maxLength} characters.`);
      }
    }
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > MAX_DURATION_DAYS) {
      deny("R12", `Duration must be 1–${MAX_DURATION_DAYS} whole days.`);
    }
    if (!Array.isArray(controls)) deny("R12", "Controls must be a list.");
    for (const control of controls) {
      if (!CONTROLS.includes(control)) deny("R12", `"${control}" is not a known control.`);
      if (COMPUTE_ONLY_CONTROLS.includes(control) && resource.type !== "compute") deny("R12", `"${control}" only applies to compute.`);
    }
    if (resource.type === "compute") {
      if (!Number.isInteger(gpuCount) || gpuCount < 1 || gpuCount > resource.maxGpus) deny("R12", `GPU count must be 1–${resource.maxGpus}.`);
    } else if (gpuCount != null) {
      deny("R12", "GPU count only applies to compute.");
    }
  }

  function normalizeScope(resource, input) {
    return {
      purposes: uniquePurposes(input.purposes),
      durationDays: Number(input.durationDays),
      controls: [...new Set(input.controls ?? [])],
      gpuCount: resource.type === "compute" ? Number(input.gpuCount) : null,
    };
  }

  function createRequest(actorSub, input) {
    return guarded("request.create", actorSub, { resourceId: input.resourceId }, () => {
      if (!hasRole(actorSub, "requester")) deny("R11", "Only people with the requester role can ask for access.");
      const resource = getResource(input.resourceId);
      const scope = normalizeScope(resource, input);
      validateScope(resource, scope);
      const justification = String(input.justification ?? "").trim();
      if (!justification) deny("R12", "Say why you need access.");

      let extendsGrantId = null;
      if (input.extendsGrantId) {
        const prior = state.grants.find((g) => g.id === input.extendsGrantId);
        if (!prior) throw new NotFound(`Grant ${input.extendsGrantId}`);
        if (prior.holderSub !== actorSub || prior.resourceId !== resource.id) deny("R13", "You can only extend your own grant on the same resource.");
        if (grantStatus(prior, now()) === "revoked") deny("R7", "A revoked grant can't be extended.");
        extendsGrantId = prior.id;
      }

      const request = {
        id: nextId("req"),
        requesterSub: actorSub,
        resourceId: resource.id,
        requested: scope,
        effective: structuredClone(scope),
        justification,
        status: "in_review",
        createdAt: now(),
        reviews: { manager: null, risk: null, owner: null },
        grantId: null,
        extendsGrantId,
      };
      state.requests.push(request);
      const extension = extendsGrantId ? ` This asks for more time on ${extendsGrantId}, so it gets a full review like any new request.` : "";
      return {
        request,
        receipt: `Submitted ${request.id}: ${resource.name}, ${list(scope.purposes)}, ${scope.durationDays} day(s)${scope.gpuCount ? `, ${scope.gpuCount} GPU(s)` : ""}. Needs manager, risk reviewer and resource owner.${extension}`,
        audit: { requestId: request.id },
      };
    });
  }

  function getRequest(id) {
    const request = state.requests.find((r) => r.id === id);
    if (!request) throw new NotFound(`Request ${id}`);
    return request;
  }

  function narrowedScope(resource, current, narrowTo = {}) {
    const next = {
      purposes: narrowTo.purposes ? uniquePurposes(narrowTo.purposes) : [...current.purposes],
      durationDays: narrowTo.durationDays != null ? Number(narrowTo.durationDays) : current.durationDays,
      controls: narrowTo.controls ? [...new Set(narrowTo.controls)] : [...current.controls],
      gpuCount: resource.type === "compute" && narrowTo.gpuCount != null ? Number(narrowTo.gpuCount) : current.gpuCount,
    };
    const widened = [];
    const currentKeys = current.purposes.map(purposeKey);
    const nextKeys = next.purposes.map(purposeKey);
    const extraPurposes = next.purposes.filter((p) => !currentKeys.includes(purposeKey(p)));
    if (extraPurposes.length) widened.push(`adds purpose ${list(extraPurposes)}`);
    if (next.durationDays > current.durationDays) widened.push(`lengthens ${current.durationDays} → ${next.durationDays} days`);
    const droppedControls = current.controls.filter((c) => !next.controls.includes(c));
    if (droppedControls.length) widened.push(`removes control ${list(droppedControls)}`);
    if (current.gpuCount != null && next.gpuCount > current.gpuCount) widened.push(`raises GPUs ${current.gpuCount} → ${next.gpuCount}`);
    if (widened.length) deny("R3", `Narrowing can only reduce scope, but this ${widened.join("; ")}.`);
    validateScope(resource, next);

    const changes = [];
    // Keep the original wording of the purposes that survive the narrowing.
    next.purposes = current.purposes.filter((p) => nextKeys.includes(purposeKey(p)));
    const removed = current.purposes.filter((p) => !nextKeys.includes(purposeKey(p)));
    if (removed.length) changes.push(`removed purpose ${list(removed)}`);
    if (next.durationDays < current.durationDays) changes.push(`${current.durationDays} → ${next.durationDays} days`);
    const added = next.controls.filter((c) => !current.controls.includes(c));
    if (added.length) changes.push(`added ${list(added)}`);
    if (current.gpuCount != null && next.gpuCount < current.gpuCount) changes.push(`${current.gpuCount} → ${next.gpuCount} GPUs`);
    if (!changes.length) deny("R12", "A narrow decision must actually reduce something.");
    return { next, changes };
  }

  function review(actorSub, requestId, input) {
    const request = getRequest(requestId);
    const { slot, decision } = input;
    return guarded(
      "request.review",
      actorSub,
      { requestId, resourceId: request.resourceId, slot, decision },
      () => {
        const resource = getResource(request.resourceId);
        if (request.status !== "in_review") deny("R12", `${request.id} is already ${request.status}.`);
        if (!SLOTS.includes(slot)) deny("R12", `Unknown review slot "${slot}".`);
        if (!["approve", "narrow", "reject"].includes(decision)) deny("R12", `Decision must be approve, narrow or reject.`);
        const reason = String(input.reason ?? "").trim();
        if (!reason) deny("R12", "Every decision needs a reason.");

        if (actorSub === request.requesterSub) {
          const holds = hasRole(actorSub, SLOT_ROLE[slot]) ? ", even though you hold that role" : "";
          deny("R1", `You submitted ${request.id}, so you can't fill its ${slot} slot${holds}.`);
        }
        if (!hasRole(actorSub, SLOT_ROLE[slot])) deny("R11", `The ${slot} slot needs the ${SLOT_ROLE[slot]} role.`);
        if (slot === "owner" && !resource.ownerSubs.includes(actorSub)) {
          deny("R9", `You hold the owner role, but you don't own ${resource.name}.`);
        }
        if (request.reviews[slot]) deny("R2", `The ${slot} slot on ${request.id} was already decided by ${nameOf(request.reviews[slot].reviewerSub)}.`);
        const otherSlot = SLOTS.find((s) => request.reviews[s]?.reviewerSub === actorSub);
        if (otherSlot) deny("R2", `You already decided the ${otherSlot} slot on ${request.id}. One person, one slot.`);

        const before = structuredClone(request.effective);
        let changes = [];
        if (decision === "narrow") {
          const narrowed = narrowedScope(resource, request.effective, input.narrowTo);
          request.effective = narrowed.next;
          changes = narrowed.changes;
        }
        request.reviews[slot] = { slot, decision, reason, reviewerSub: actorSub, at: now(), before, after: structuredClone(request.effective), changes };

        let receipt;
        let grant = null;
        if (decision === "reject") {
          request.status = "rejected";
          receipt = `${slot} rejected ${request.id}: "${reason}". Any reject ends the request.`;
        } else {
          const verb = decision === "narrow" ? `narrowed (${changes.join("; ")})` : "approved";
          receipt = `${slot} ${verb} ${request.id}: "${reason}".`;
          if (SLOTS.every((s) => request.reviews[s])) {
            grant = issueGrant(request, resource);
            receipt += ` All three slots decided → grant ${grant.id} issued until ${fmt(grant.expiresAt)}.`;
            if (grant.extendsGrantId) {
              const prior = state.grants.find((g) => g.id === grant.extendsGrantId);
              receipt +=
                grant.startsAt === prior.expiresAt
                  ? ` It starts when ${prior.id} ends, with no gap.`
                  : ` ${prior.id} ended at ${fmt(prior.expiresAt)} before this was approved, so there was no access from then until ${fmt(grant.startsAt)}. Extensions never backdate.`;
            }
            receipt += ` ${NOT_SAFE}`;
          } else {
            const waiting = SLOTS.filter((s) => !request.reviews[s]);
            receipt += ` Still waiting on: ${list(waiting)}.`;
          }
        }
        return { request, grant, receipt, audit: grant ? { grantId: grant.id } : {} };
      },
    );
  }

  function issueGrant(request, resource) {
    let startsAt = now();
    if (request.extendsGrantId) {
      const prior = state.grants.find((g) => g.id === request.extendsGrantId);
      if (prior && ["active", "scheduled"].includes(grantStatus(prior, startsAt))) startsAt = prior.expiresAt;
    }
    const scope = request.effective;
    const grant = lockGrant({
      id: nextId("grant"),
      requestId: request.id,
      holderSub: request.requesterSub,
      resourceId: resource.id,
      purposes: scope.purposes,
      controls: scope.controls,
      gpuCount: scope.gpuCount,
      startsAt,
      expiresAt: startsAt + scope.durationDays * DAY,
      credential: `mock_key_${newSecret()}`,
      revokedAt: null,
      revokedBySub: null,
      revokeReason: null,
      extendsGrantId: request.extendsGrantId,
    });
    state.grants.push(grant);
    request.status = "approved";
    request.grantId = grant.id;
    return grant;
  }

  // ---------- use ----------

  function grantForCredential(actorSub, credential, expectType) {
    const grant = state.grants.find((g) => g.credential === credential);
    if (!grant) deny("R13", "No grant matches this credential.");
    if (grant.holderSub !== actorSub) deny("R13", `This credential belongs to ${nameOf(grant.holderSub)}, not you.`, { grantId: grant.id });
    const resource = getResource(grant.resourceId);
    if (expectType === "compute" && resource.type !== "compute") deny("R13", `${grant.id} is for ${resource.name}, not a compute pool.`, { grantId: grant.id });
    if (expectType !== "compute" && resource.type === "compute") deny("R13", `${grant.id} is a compute grant; submit a job instead.`, { grantId: grant.id });
    const status = grantStatus(grant, now());
    if (status === "revoked") deny("R7", `${grant.id} was revoked by ${nameOf(grant.revokedBySub)} at ${fmt(grant.revokedAt)}: "${grant.revokeReason}".`, { grantId: grant.id });
    if (status === "expired") deny("R6", `${grant.id} expired at ${fmt(grant.expiresAt)}. More time needs a new request.`, { grantId: grant.id });
    if (status === "scheduled") deny("R6", `${grant.id} doesn't start until ${fmt(grant.startsAt)}.`, { grantId: grant.id });
    return { grant, resource };
  }

  function use(actorSub, input) {
    return guarded("resource.use", actorSub, { resourceId: input.resourceId ?? null, purpose: input.purpose }, () => {
      const { grant, resource } = grantForCredential(actorSub, input.credential, "model-or-dataset");
      if (input.resourceId && input.resourceId !== grant.resourceId) {
        deny("R13", `${grant.id} is for ${resource.name}, not ${input.resourceId}.`, { grantId: grant.id });
      }
      const purpose = approvedPurpose(grant, input.purpose);
      if (!purpose) deny("R4", `${grant.id} is approved for ${quoted(grant.purposes)}; this call was for "${normalizePurpose(input.purpose)}".`, { grantId: grant.id });
      const output = mockOutput(resource, grant, String(input.input ?? ""));
      return {
        output,
        banner: "Mock output. Authorization ≠ safety.",
        receipt: `Allowed: ${resource.name} for "${purpose}" under ${grant.id} (controls: ${list(grant.controls) || "none"}; expires ${fmt(grant.expiresAt)}). ${NOT_SAFE}`,
        audit: { grantId: grant.id, resourceId: resource.id },
      };
    });
  }

  function submitJob(actorSub, input) {
    return guarded("job.submit", actorSub, { purpose: input.purpose, gpus: input.gpus }, () => {
      const { grant, resource } = grantForCredential(actorSub, input.credential, "compute");
      const t = now();
      const purpose = approvedPurpose(grant, input.purpose);
      if (!purpose) deny("R4", `${grant.id} is approved for ${quoted(grant.purposes)}; this job is for "${normalizePurpose(input.purpose)}".`, { grantId: grant.id });
      const gpus = Number(input.gpus);
      const hours = Number(input.hours ?? 4);
      if (!Number.isInteger(gpus) || gpus < 1) deny("R12", "A job needs a whole number of GPUs.", { grantId: grant.id });
      if (!(hours > 0 && hours <= MAX_JOB_HOURS)) deny("R12", `Job runtime must be up to ${MAX_JOB_HOURS} hours.`, { grantId: grant.id });
      const inUse = state.jobs
        .filter((j) => j.grantId === grant.id && jobStatus(j, grant, t) === "running")
        .reduce((sum, j) => sum + j.gpus, 0);
      if (inUse + gpus > grant.gpuCount) {
        deny("R5", `${grant.id} allows ${grant.gpuCount} GPU(s); ${inUse} in use, this job asks for ${gpus}.`, { grantId: grant.id });
      }
      const image = String(input.image ?? "");
      if (grant.controls.includes("approved-images-only") && !APPROVED_IMAGES.includes(image)) {
        deny("R10", `"${image}" isn't on the approved image list (${list(APPROVED_IMAGES)}).`, { grantId: grant.id });
      }
      const job = {
        id: nextId("job"),
        grantId: grant.id,
        holderSub: actorSub,
        gpus,
        purpose,
        image,
        hours,
        startedAt: t,
        killedAt: null,
        killReason: null,
      };
      state.jobs.push(job);
      return {
        job: viewJob(job, t),
        receipt: `Allowed: mock job ${job.id} on ${gpus}× H100 for "${purpose}" under ${grant.id}. It will be killed if the grant expires or is revoked. ${NOT_SAFE}`,
        audit: { grantId: grant.id, resourceId: resource.id, jobId: job.id },
      };
    });
  }

  // ---------- revoke and (the absence of) extension ----------

  function revoke(actorSub, grantId, reasonInput) {
    const grant = state.grants.find((g) => g.id === grantId);
    if (!grant) throw new NotFound(`Grant ${grantId}`);
    return guarded("grant.revoke", actorSub, { grantId, resourceId: grant.resourceId, requestId: grant.requestId }, () => {
      const resource = getResource(grant.resourceId);
      const isOwner = resource.ownerSubs.includes(actorSub) && hasRole(actorSub, "owner");
      if (!hasRole(actorSub, "risk") && !isOwner) deny("R11", "Only a risk reviewer or this resource's owner can revoke.");
      const reason = String(reasonInput ?? "").trim();
      if (!reason) deny("R12", "Emergency revocation needs a reason.");
      const t = now();
      const status = grantStatus(grant, t);
      if (status === "revoked") deny("R7", `${grant.id} is already revoked.`);
      if (status === "expired") deny("R6", `${grant.id} already expired; there is nothing to revoke.`);
      grant.revokedAt = t;
      grant.revokedBySub = actorSub;
      grant.revokeReason = reason;
      const killed = [];
      for (const job of state.jobs.filter((j) => j.grantId === grant.id)) {
        if (jobStatus(job, grant, t) === "running") {
          job.killedAt = t;
          job.killReason = "emergency revocation";
          killed.push(job.id);
        }
      }
      return {
        grant: viewGrant(grant, actorSub, t),
        killedJobs: killed,
        receipt: `Revoked ${grant.id} immediately: "${reason}".${killed.length ? ` Killed running job(s) ${list(killed)}.` : ""} Every later use is denied (R7).`,
      };
    });
  }

  function attemptExpiryChange(actorSub, grantId) {
    return guarded("grant.modify-expiry", actorSub, { grantId }, () =>
      deny("R8", `There is no way to change ${grantId}'s expiry. Ask for more time with a new request (extendsGrantId) that goes through full review.`),
    );
  }

  // ---------- views ----------

  function viewGrant(grant, viewerSub, t = now()) {
    const status = grantStatus(grant, t);
    const resource = getResource(grant.resourceId);
    return {
      id: grant.id,
      requestId: grant.requestId,
      holderSub: grant.holderSub,
      holderName: nameOf(grant.holderSub),
      resourceId: grant.resourceId,
      resourceName: resource.name,
      resourceType: resource.type,
      purposes: [...grant.purposes],
      controls: [...grant.controls],
      gpuCount: grant.gpuCount,
      startsAt: grant.startsAt,
      expiresAt: grant.expiresAt,
      remainingMs: status === "active" ? grant.expiresAt - t : 0,
      status,
      revokedAt: grant.revokedAt,
      revokedByName: grant.revokedBySub ? nameOf(grant.revokedBySub) : null,
      revokeReason: grant.revokeReason,
      extendsGrantId: grant.extendsGrantId,
      credential: viewerSub === grant.holderSub ? grant.credential : null,
    };
  }

  function viewJob(job, t = now()) {
    const grant = state.grants.find((g) => g.id === job.grantId);
    const status = jobStatus(job, grant, t);
    const end = jobEnd(job, grant);
    const elapsed = Math.max(0, Math.min(t, end) - job.startedAt);
    return {
      ...job,
      holderName: nameOf(job.holderSub),
      status,
      killReason: job.killReason ?? (status === "killed" ? "grant expired" : null),
      progress: Math.min(1, elapsed / (job.hours * HOUR)),
    };
  }

  function viewRequest(request) {
    const resource = getResource(request.resourceId);
    const reviews = Object.fromEntries(
      SLOTS.map((slot) => {
        const r = request.reviews[slot];
        return [slot, r ? { ...r, reviewerName: nameOf(r.reviewerSub) } : null];
      }),
    );
    return { ...request, requesterName: nameOf(request.requesterSub), resourceName: resource.name, resourceType: resource.type, reviews };
  }

  // ---------- who can see what ----------
  // Enforced here, not in the UI. A requester sees only their own requests, grants, jobs and
  // history. A manager sees every request (any manager may fill the manager slot) and the grants
  // of requests they decided. An owner sees what happens on the resources they own. Risk
  // reviewers and the admin see everything. Credentials are only ever shown to their holder.
  // Without a viewer (internal callers, exports in scripts) nothing is filtered.
  function scopeFor(viewerSub) {
    if (viewerSub === undefined) return { all: true, request: () => true, grant: () => true, job: () => true, event: () => true };
    const roles = state.users[viewerSub]?.roles ?? [];
    const all = roles.includes("risk") || roles.includes("admin");
    const manager = roles.includes("manager");
    const owned = new Set(roles.includes("owner") ? state.resources.filter((r) => r.ownerSubs.includes(viewerSub)).map((r) => r.id) : []);
    const decided = (request) => SLOTS.some((slot) => request.reviews[slot]?.reviewerSub === viewerSub);
    const request = (r) => all || r.requesterSub === viewerSub || manager || owned.has(r.resourceId) || decided(r);
    const grant = (g) => {
      if (all || g.holderSub === viewerSub || owned.has(g.resourceId)) return true;
      const origin = state.requests.find((r) => r.id === g.requestId);
      return Boolean(origin && decided(origin));
    };
    const job = (j) => {
      const g = state.grants.find((x) => x.id === j.grantId);
      return all || j.holderSub === viewerSub || (g && owned.has(g.resourceId));
    };
    const event = (e) => {
      if (all || e.actorSub === viewerSub) return true;
      if (e.grantId) {
        const g = state.grants.find((x) => x.id === e.grantId);
        return Boolean(g && grant(g));
      }
      if (e.requestId) {
        const r = state.requests.find((x) => x.id === e.requestId);
        return Boolean(r && request(r));
      }
      return false;
    };
    return { all, request, grant, job, event };
  }

  function listRequests(viewerSub) {
    const scope = scopeFor(viewerSub);
    return state.requests.filter(scope.request).map(viewRequest).reverse();
  }

  function listGrants(viewerSub) {
    const t = now();
    const scope = scopeFor(viewerSub);
    return state.grants.filter(scope.grant).map((g) => viewGrant(g, viewerSub, t)).reverse();
  }

  function listJobs(viewerSub) {
    const t = now();
    const scope = scopeFor(viewerSub);
    return state.jobs.filter(scope.job).map((j) => viewJob(j, t)).reverse();
  }

  // Everyone who has signed in, for the admin's people directory.
  function listUsers() {
    return Object.values(state.users)
      .map((u) => ({ sub: u.sub, name: u.name, email: u.email ?? null, roles: [...u.roles], firstSeenAt: u.firstSeenAt ?? null, owns: state.resources.filter((r) => r.ownerSubs.includes(u.sub)).map((r) => r.id) }))
      .sort((a, b) => (a.firstSeenAt ?? 0) - (b.firstSeenAt ?? 0));
  }

  // ---------- per-reviewer dashboards ----------

  // One dashboard per review slot. The server decides what each reviewer sees: holding the
  // slot's role is rule R11, and a refused attempt is logged. Opening a dashboard is a read,
  // so allowed opens aren't logged (the UI polls every few seconds).
  function dashboard(viewerSub, role) {
    if (!SLOTS.includes(role)) throw new NotFound(`Dashboard "${role}"`);
    const slot = role;
    if (!hasRole(viewerSub, SLOT_ROLE[slot])) {
      try {
        deny("R11", `The ${slot} dashboard needs the ${SLOT_ROLE[slot]} role.`);
      } catch (error) {
        record({ action: "dashboard.open", actorSub: viewerSub, allowed: false, rule: error.rule, receipt: error.receipt, dashboard: slot });
        onChange(state);
        throw error;
      }
    }

    const t = now();
    const ownedIds = new Set(state.resources.filter((r) => r.ownerSubs.includes(viewerSub)).map((r) => r.id));
    const inScope = (resourceId) => slot !== "owner" || ownedIds.has(resourceId);
    const live = (g) => ["active", "scheduled"].includes(grantStatus(g, t));

    // Requests whose slot is still open, split by what this viewer is allowed to do with them.
    const waiting = { actionable: [], yours: [], otherSlot: [] };
    for (const request of [...state.requests].reverse()) {
      if (request.status !== "in_review" || request.reviews[slot] || !inScope(request.resourceId)) continue;
      const view = viewRequest(request);
      if (request.requesterSub === viewerSub) waiting.yours.push(view); // R1
      else if (SLOTS.some((s) => request.reviews[s]?.reviewerSub === viewerSub)) waiting.otherSlot.push(view); // R2
      else waiting.actionable.push(view);
    }
    const decidedByYou = state.requests
      .filter((r) => r.reviews[slot]?.reviewerSub === viewerSub)
      .slice(-10)
      .reverse()
      .map(viewRequest);

    const result = { role: slot, now: t, ...waiting, decidedByYou };

    if (slot === "risk") {
      result.activeGrants = state.grants.filter(live).reverse().map((g) => viewGrant(g, viewerSub, t));
      result.runningJobs = state.jobs.filter((j) => jobStatus(j, state.grants.find((g) => g.id === j.grantId), t) === "running").map((j) => viewJob(j, t));
      result.recentDenials = state.audit.filter((e) => !e.allowed).slice(-15).reverse();
    }

    if (slot === "owner") {
      result.resources = state.resources
        .filter((r) => ownedIds.has(r.id))
        .map((resource) => {
          const grants = state.grants.filter((g) => g.resourceId === resource.id && live(g));
          const running = state.jobs.filter((j) => {
            const grant = state.grants.find((g) => g.id === j.grantId);
            return grant.resourceId === resource.id && jobStatus(j, grant, t) === "running";
          });
          return {
            id: resource.id,
            name: resource.name,
            type: resource.type,
            maxGpus: resource.maxGpus ?? null,
            liveGrants: grants.length,
            gpusGranted: resource.type === "compute" ? grants.reduce((sum, g) => sum + (g.gpuCount ?? 0), 0) : null,
            gpusRunning: resource.type === "compute" ? running.reduce((sum, j) => sum + j.gpus, 0) : null,
          };
        });
      result.activeGrants = state.grants.filter((g) => ownedIds.has(g.resourceId) && live(g)).reverse().map((g) => viewGrant(g, viewerSub, t));
    }

    return result;
  }

  function history(filter = {}, viewerSub) {
    const scope = scopeFor(viewerSub);
    const events = state.audit
      .filter(scope.event)
      .filter((e) => !filter.requestId || e.requestId === filter.requestId)
      .filter((e) => !filter.resourceId || e.resourceId === filter.resourceId)
      .filter((e) => !filter.grantId || e.grantId === filter.grantId);
    const limit = filter.limit === undefined ? events.length : Math.min(Math.max(Math.trunc(Number(filter.limit)) || 1, 1), 5000);
    // Entries written before actorName was recorded fall back to the current name.
    return events.slice(-limit).map((e) => (e.actorName !== undefined ? e : { ...e, actorName: e.actorSub ? nameOf(e.actorSub) : null }));
  }

  function score(sub) {
    return computeScore(state, sub, now());
  }

  function demoAdvanceClock(actorSub, hours) {
    clock.advance(hours * HOUR);
    // Persisted so a restart can't "un-expire" grants by resetting the demo clock.
    state.clockOffsetMs = (state.clockOffsetMs ?? 0) + hours * HOUR;
    record({ action: "demo.clock-advance", actorSub, allowed: true, rule: null, receipt: `Demo-only: clock moved forward ${hours} hour(s) to ${fmt(now())}.` });
    onChange(state);
    return { now: now() };
  }

  return {
    state,
    now,
    upsertUser,
    getUser,
    hasRole,
    setRoles,
    createRequest,
    review,
    use,
    submitJob,
    revoke,
    attemptExpiryChange,
    listRequests,
    listGrants,
    listJobs,
    history,
    dashboard,
    listUsers,
    score,
    demoAdvanceClock,
    resources: () => state.resources,
  };
}

function uniquePurposes(input) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const purpose = normalizePurpose(raw);
    if (!purpose || seen.has(purposeKey(purpose))) continue;
    seen.add(purposeKey(purpose));
    out.push(purpose);
  }
  return out;
}

// The grant's own wording of the purpose a call names, or null if it isn't approved.
function approvedPurpose(grant, requested) {
  const key = purposeKey(requested);
  return key ? (grant.purposes.find((p) => purposeKey(p) === key) ?? null) : null;
}

const quoted = (items) => items.map((p) => `"${p}"`).join(", ");

function mockOutput(resource, grant, input) {
  const seed = [...input].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const watermark = grant.controls.includes("output-watermark") ? { watermark: `MOCK-${grant.id}` } : {};
  if (resource.id === "model:sentinel-eval-mock") {
    return { model: resource.id, mockScore: Number(((seed % 1000) / 1000).toFixed(3)), label: "MOCK_LABEL_NOT_REAL", ...watermark };
  }
  if (resource.type === "model") {
    return { model: resource.id, summary: "Lorem ipsum dolor sit amet (mock summary, not real output).", ...watermark };
  }
  const rows = Array.from({ length: grant.controls.includes("no-export") ? 3 : 5 }, (_, i) => ({
    id: `SYNTHETIC-${String(((seed + i) % 50) + 1).padStart(3, "0")}`,
    text: `SYNTHETIC ${resource.type} row ${i + 1} (fake data)`,
  }));
  return {
    dataset: resource.id,
    rows,
    exportAllowed: !grant.controls.includes("no-export"),
    note: grant.controls.includes("no-export") ? "Preview only: no-export control is set." : "Synthetic rows.",
    ...watermark,
  };
}
