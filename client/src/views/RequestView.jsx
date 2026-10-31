import { useEffect, useState } from "react";
import { api, when } from "../api.js";
import { Chips, Receipt, Status } from "../ui.jsx";

const COMPUTE_ONLY = ["no-network-egress", "approved-images-only"];
const blank = (resourceId) => ({ resourceId, purposes: [""], durationDays: 7, controls: [], gpuCount: 2, justification: "" });

// The request form. Purposes are free text: say exactly what you'll use it for. Use is later
// allowed only for a purpose that was approved, word for word (ignoring case and spacing).
export function RequestForm({ ctx, extendFrom, clearExtend }) {
  const { resources, meta } = ctx;
  const limits = meta.purposeLimits;
  const [form, setForm] = useState(blank(resources[0]?.id));
  const [result, setResult] = useState(null);
  const resource = resources.find((r) => r.id === form.resourceId);

  useEffect(() => {
    if (!extendFrom) return;
    setForm({
      resourceId: extendFrom.resourceId,
      purposes: [...extendFrom.purposes],
      durationDays: 7,
      controls: [...extendFrom.controls],
      gpuCount: extendFrom.gpuCount ?? 2,
      justification: "",
    });
  }, [extendFrom]);

  const toggle = (key, value) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));
  const setPurpose = (i, value) => setForm((f) => ({ ...f, purposes: f.purposes.map((p, j) => (j === i ? value : p)) }));
  const addPurpose = (value = "") =>
    setForm((f) => {
      const empty = f.purposes.findIndex((p) => !p.trim());
      if (value && empty >= 0) return { ...f, purposes: f.purposes.map((p, j) => (j === empty ? value : p)) };
      return f.purposes.length < limits.maxPurposes ? { ...f, purposes: [...f.purposes, value] } : f;
    });
  const removePurpose = (i) => setForm((f) => ({ ...f, purposes: f.purposes.length > 1 ? f.purposes.filter((_, j) => j !== i) : [""] }));

  async function submit(event) {
    event.preventDefault();
    const body = { ...form, purposes: form.purposes.map((p) => p.trim()).filter(Boolean), durationDays: Number(form.durationDays) };
    if (resource?.type === "compute") body.gpuCount = Number(form.gpuCount);
    else delete body.gpuCount;
    if (extendFrom) body.extendsGrantId = extendFrom.id;
    const res = await api("/api/requests", { method: "POST", body });
    setResult(res);
    if (res.ok) {
      clearExtend();
      setForm(blank(form.resourceId));
      ctx.refresh();
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{extendFrom ? `Ask for more time on ${extendFrom.id}` : "Request access"}</h2>
      {extendFrom && (
        <p className="note">
          There is no "extend" button. More time is a <strong>new request</strong> linked to {extendFrom.id} that goes through the full three-person review.
          If approved, it starts when the current grant ends.{" "}
          <button type="button" className="link" onClick={clearExtend}>Cancel</button>
        </p>
      )}
      <label>
        Resource
        <select value={form.resourceId} disabled={Boolean(extendFrom)} onChange={(e) => setForm({ ...blank(e.target.value), justification: form.justification })}>
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {resource && <p className="muted small">{resource.description}</p>}

      <fieldset>
        <legend>What will you use it for?</legend>
        <p className="small muted">
          Write each purpose in your own words (up to {limits.maxPurposes}). Once approved, the access works only for these purposes, exactly as approved.
        </p>
        {form.purposes.map((p, i) => (
          <div key={i} className="purpose-row">
            <input
              aria-label={`Purpose ${i + 1}`}
              value={p}
              maxLength={limits.maxLength}
              placeholder="e.g. Evaluate jailbreak resistance on 200 synthetic prompts"
              onChange={(e) => setPurpose(i, e.target.value)}
            />
            {form.purposes.length > 1 && (
              <button type="button" className="ghost small-btn" onClick={() => removePurpose(i)} aria-label={`Remove purpose ${i + 1}`}>
                Remove
              </button>
            )}
          </div>
        ))}
        <div className="suggest">
          {form.purposes.length < limits.maxPurposes && (
            <button type="button" className="link" onClick={() => addPurpose()}>
              + Add another purpose
            </button>
          )}
          {resource?.suggestedPurposes?.length > 0 && (
            <span className="small muted">
              Common for this resource:{" "}
              {resource.suggestedPurposes.map((s) => (
                <button key={s} type="button" className="chip chip-btn" onClick={() => addPurpose(s)}>
                  {s}
                </button>
              ))}
            </span>
          )}
        </div>
      </fieldset>

      <div className="row">
        <label>
          Duration (days, max {meta.maxDurationDays})
          <input type="number" min="1" max={meta.maxDurationDays} value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value })} />
        </label>
        {resource?.type === "compute" && (
          <label>
            H100 GPUs (max {resource.maxGpus})
            <input type="number" min="1" max={resource.maxGpus} value={form.gpuCount} onChange={(e) => setForm({ ...form, gpuCount: e.target.value })} />
          </label>
        )}
      </div>

      <fieldset>
        <legend>Risk controls</legend>
        {meta.controls
          .filter((c) => resource?.type === "compute" || !COMPUTE_ONLY.includes(c))
          .map((c) => (
            <label key={c} className="check">
              <input type="checkbox" checked={form.controls.includes(c)} onChange={() => toggle("controls", c)} /> {c}
            </label>
          ))}
      </fieldset>

      <label>
        Why do you need it?
        <textarea rows="3" value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} placeholder="e.g. Two-week evaluation of the mock model for my thesis" />
      </label>
      <button className="button" type="submit">Submit for review</button>
      <Receipt result={result} />
    </form>
  );
}

export function MyRequests({ requests }) {
  return (
    <section className="card">
      <h2>My requests</h2>
      {requests.length === 0 && <p className="muted">Nothing yet.</p>}
      {requests.map((r) => (
        <article key={r.id} className="item">
          <div className="item-head">
            <strong>
              {r.id} · {r.resourceName}
            </strong>
            <Status value={r.status} />
          </div>
          <div className="small">
            Asked for: <Chips items={r.requested.purposes} /> · {r.requested.durationDays}d{r.requested.gpuCount ? ` · ${r.requested.gpuCount} GPUs` : ""}
            {r.extendsGrantId && <> · extends {r.extendsGrantId}</>}
          </div>
          <SlotSummary request={r} />
          <div className="muted small">Submitted {when(r.createdAt)}</div>
        </article>
      ))}
    </section>
  );
}

export function SlotSummary({ request }) {
  return (
    <ul className="slots">
      {["manager", "risk", "owner"].map((slot) => {
        const review = request.reviews[slot];
        return (
          <li key={slot} className={review ? `slot d-${review.decision}` : "slot pending"}>
            <strong>{slot}</strong>{" "}
            {review ? (
              <>
                {review.decision} by {review.reviewerName}
                {review.changes?.length > 0 && <> ({review.changes.join("; ")})</>} — “{review.reason}”
              </>
            ) : (
              "waiting"
            )}
          </li>
        );
      })}
    </ul>
  );
}
