import { useState } from "react";
import { api, when } from "../api.js";
import { Chips, Receipt, ScoreCard, Status } from "../ui.jsx";
import { SlotSummary } from "./RequestView.jsx";

const SLOT_ROLE = { manager: "manager", risk: "risk", owner: "owner" };

// One request with the slot forms a reviewer may use. onlySlot limits it to one dashboard's slot.
// onDecided lets the dashboard keep the receipt on screen after the card leaves its list.
export function ReviewCard({ request, ctx, mine, onlySlot, onDecided }) {
  const { user, meta } = ctx;
  const [result, setResult] = useState(null);
  const eff = request.effective;
  return (
    <section className="card review">
      <div className="item-head">
        <h2>
          {request.id} · {request.resourceName}
        </h2>
        <Status value={request.status} />
      </div>
      <div className="grid two">
        <div>
          <p>
            <strong>{request.requesterName}</strong> {mine && <span className="chip warn">your request</span>} asks for:
          </p>
          <ul className="facts">
            <li>Purposes: <Chips items={eff.purposes} /></li>
            <li>Duration: {eff.durationDays} day(s)</li>
            {eff.gpuCount != null && <li>GPUs: {eff.gpuCount}× H100 (mock)</li>}
            <li>Controls: <Chips items={eff.controls} /></li>
            <li>Why: “{request.justification}”</li>
            <li className="muted small">Submitted {when(request.createdAt)}{request.extendsGrantId && ` · extends ${request.extendsGrantId}`}</li>
          </ul>
          <SlotSummary request={request} />
        </div>
        <ScoreCard sub={request.requesterSub} />
      </div>
      <div className="slot-actions">
        {["manager", "risk", "owner"]
          .filter((slot) => !request.reviews[slot] && (!onlySlot || slot === onlySlot))
          .map((slot) => (
            <SlotForm
              key={slot}
              slot={slot}
              request={request}
              meta={meta}
              suggested={user.roles.includes(SLOT_ROLE[slot])}
              onResult={(res) => {
                onDecided?.(res);
                setResult(res);
                ctx.refresh();
              }}
            />
          ))}
      </div>
      <Receipt result={result} />
    </section>
  );
}

function SlotForm({ slot, request, meta, suggested, onResult }) {
  const eff = request.effective;
  const [reason, setReason] = useState("");
  const [narrowing, setNarrowing] = useState(false);
  const [narrow, setNarrow] = useState({ purposes: eff.purposes, durationDays: eff.durationDays, gpuCount: eff.gpuCount, controls: eff.controls });

  async function decide(decision) {
    const body = { slot, decision, reason };
    if (decision === "narrow") body.narrowTo = { ...narrow, durationDays: Number(narrow.durationDays), gpuCount: narrow.gpuCount == null ? undefined : Number(narrow.gpuCount) };
    onResult(await api(`/api/requests/${request.id}/reviews`, { method: "POST", body }));
    setReason("");
    setNarrowing(false);
  }

  const toggle = (key, value) => setNarrow((n) => ({ ...n, [key]: n[key].includes(value) ? n[key].filter((v) => v !== value) : [...n[key], value] }));
  const controls = meta.controls.filter((c) => request.resourceType === "compute" || !["no-network-egress", "approved-images-only"].includes(c));

  return (
    <div className={`slotform ${suggested ? "suggested" : ""}`}>
      <h3>
        {slot} slot {suggested && <span className="chip">your role</span>}
      </h3>
      <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {narrowing && (
        <div className="narrow">
          <div>
            {eff.purposes.map((p) => (
              <label key={p} className="check">
                <input type="checkbox" checked={narrow.purposes.includes(p)} onChange={() => toggle("purposes", p)} /> keep {p}
              </label>
            ))}
          </div>
          <label>
            Days
            <input type="number" min="1" max={eff.durationDays} value={narrow.durationDays} onChange={(e) => setNarrow({ ...narrow, durationDays: e.target.value })} />
          </label>
          {eff.gpuCount != null && (
            <label>
              GPUs
              <input type="number" min="1" max={eff.gpuCount} value={narrow.gpuCount} onChange={(e) => setNarrow({ ...narrow, gpuCount: e.target.value })} />
            </label>
          )}
          <div>
            {controls.map((c) => (
              <label key={c} className="check">
                <input type="checkbox" checked={narrow.controls.includes(c)} disabled={eff.controls.includes(c)} onChange={() => toggle("controls", c)} /> {c}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="btns">
        <button onClick={() => decide("approve")}>Approve</button>
        {narrowing ? <button onClick={() => decide("narrow")}>Confirm narrow</button> : <button onClick={() => setNarrowing(true)}>Narrow…</button>}
        <button className="danger" onClick={() => decide("reject")}>Reject</button>
      </div>
    </div>
  );
}
