import { useEffect, useState } from "react";
import { api } from "../api.js";

export function HistoryView({ ctx }) {
  const { resources } = ctx;
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState({ resourceId: "", requestId: "", outcome: "all" });

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter.resourceId) params.set("resourceId", filter.resourceId);
    if (filter.requestId) params.set("requestId", filter.requestId.trim());
    api(`/api/history?${params}`).then((res) => res.ok && setEvents(res.data));
  }, [filter.resourceId, filter.requestId, ctx.requests, ctx.grants]);

  const shown = events.filter((e) => filter.outcome === "all" || (filter.outcome === "denied" ? !e.allowed : e.allowed)).reverse();
  const params = new URLSearchParams(Object.entries({ resourceId: filter.resourceId, requestId: filter.requestId }).filter(([, v]) => v));

  return (
    <section className="card">
      <div className="item-head">
        <h2>Decision history</h2>
        <a className="button small-btn" href={`/api/history/export?${params}`}>
          Export JSON
        </a>
      </div>
      <p className="muted small">Append-only. Every allow and every denial, with its receipt. Credentials never appear here.</p>
      <div className="row">
        <label>
          Resource
          <select value={filter.resourceId} onChange={(e) => setFilter({ ...filter, resourceId: e.target.value })}>
            <option value="">All</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Request id
          <input placeholder="req_3" value={filter.requestId} onChange={(e) => setFilter({ ...filter, requestId: e.target.value })} />
        </label>
        <label>
          Outcome
          <select value={filter.outcome} onChange={(e) => setFilter({ ...filter, outcome: e.target.value })}>
            <option value="all">All</option>
            <option value="allowed">Allowed</option>
            <option value="denied">Denied</option>
          </select>
        </label>
      </div>
      <ol className="timeline">
        {shown.map((e) => (
          <li key={e.seq} className={e.allowed ? "ok" : "no"}>
            <div className="tl-head">
              <span className="small muted">#{e.seq} · {new Date(e.at).toLocaleString()}</span>
              <strong>{e.action}</strong>
              <span>{e.actorName}</span>
              {e.rule && <span className="rule">{e.rule}</span>}
            </div>
            <div className="small">{e.receipt}</div>
          </li>
        ))}
        {shown.length === 0 && <p className="muted">No events.</p>}
      </ol>
    </section>
  );
}
