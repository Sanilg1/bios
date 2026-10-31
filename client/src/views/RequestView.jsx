import { useEffect, useState } from "react";
import { api, when } from "../api.js";
import { Chips, Receipt, Status } from "../ui.jsx";

const COMPUTE_ONLY = ["no-network-egress", "approved-images-only"];

export function RequestView({ ctx, extendFrom, clearExtend }) {
  const { resources, meta, requests, user } = ctx;
  const [form, setForm] = useState({ resourceId: resources[0]?.id, purposes: [], durationDays: 7, controls: [], gpuCount: 2, justification: "" });
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

  async function submit(event) {
    event.preventDefault();
    const body = { ...form, durationDays: Number(form.durationDays) };
    if (resource?.type === "compute") body.gpuCount = Number(form.gpuCount);
    else delete body.gpuCount;
    if (extendFrom) body.extendsGrantId = extendFrom.id;
    const res = await api("/api/requests", { method: "POST", body });
    setResult(res);
    if (res.ok) {
      clearExtend();
      setForm((f) => ({ ...f, justification: "" }));
      ctx.refresh();
    }
  }

  const mine = requests.filter((r) => r.requesterSub === user.sub);

  return (
    <div className="grid two">
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
          <select value={form.resourceId} disabled={Boolean(extendFrom)} onChange={(e) => setForm({ ...form, resourceId: e.target.value, purposes: [] })}>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {resource && <p className="muted small">{resource.description}</p>}

        <fieldset>
          <legend>Purpose(s)</legend>
          {resource?.allowedPurposes.map((p) => (
            <label key={p} className="check">
              <input type="checkbox" checked={form.purposes.includes(p)} onChange={() => toggle("purposes", p)} /> {p}
            </label>
          ))}
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

      <section className="card">
        <h2>My requests</h2>
        {mine.length === 0 && <p className="muted">Nothing yet.</p>}
        {mine.map((r) => (
          <article key={r.id} className="item">
            <div className="item-head">
              <strong>{r.id}</strong> · {r.resourceName} <Status value={r.status} />
            </div>
            <div className="small">
              Asked: <Chips items={r.requested.purposes} /> · {r.requested.durationDays}d{r.requested.gpuCount ? ` · ${r.requested.gpuCount} GPUs` : ""}
              {r.extendsGrantId && <> · extends {r.extendsGrantId}</>}
            </div>
            <SlotSummary request={r} />
            <div className="muted small">Submitted {when(r.createdAt)}</div>
          </article>
        ))}
      </section>
    </div>
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
