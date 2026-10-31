import { useState } from "react";
import { api, remaining, when } from "../api.js";
import { Chips, Receipt, Status } from "../ui.jsx";

export function GrantsView({ ctx }) {
  const { grants, jobs, user } = ctx;
  const mine = grants.filter((g) => g.holderSub === user.sub);
  const active = grants.filter((g) => g.status === "active" || g.status === "scheduled");
  const ended = grants.filter((g) => g.status === "expired" || g.status === "revoked");

  return (
    <div>
      {mine.filter((g) => g.status === "active").map((g) => (
        <UseConsole key={g.id} grant={g} ctx={ctx} />
      ))}

      <section className="card">
        <h2>Active grants</h2>
        <GrantTable grants={active} ctx={ctx} empty="No active grants." />
      </section>

      <section className="card">
        <h2>Mock H100 jobs</h2>
        {jobs.length === 0 && <p className="muted">No jobs yet. Nothing here touches real GPUs.</p>}
        {jobs.map((j) => (
          <div key={j.id} className="job">
            <div className="item-head">
              <strong>{j.id}</strong> · {j.holderName} · {j.gpus}× H100 · {j.purpose} · <code>{j.image}</code> <Status value={j.status} />
            </div>
            <progress className={`p-${j.status}`} max="1" value={j.progress} />
            {j.killReason && <span className="small denied-text">killed: {j.killReason}</span>}
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Ended grants</h2>
        <GrantTable grants={ended} ctx={ctx} empty="None yet." />
      </section>
    </div>
  );
}

export function GrantTable({ grants, ctx, empty }) {
  const { user } = ctx;
  const [result, setResult] = useState(null);
  const canRevoke = user.roles.includes("risk") || user.roles.includes("owner");

  async function revoke(grant) {
    const reason = window.prompt(`Emergency revoke ${grant.id}. Reason (required):`);
    if (reason === null) return;
    setResult(await api(`/api/grants/${grant.id}/revoke`, { method: "POST", body: { reason } }));
    ctx.refresh();
  }

  if (!grants.length) return <p className="muted">{empty}</p>;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Grant</th>
              <th>Holder</th>
              <th>Resource</th>
              <th>Purposes</th>
              <th>Controls</th>
              <th>Status</th>
              <th>Window</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id}>
                <td>
                  <strong>{g.id}</strong>
                  {g.extendsGrantId && <div className="small muted">extends {g.extendsGrantId}</div>}
                </td>
                <td>{g.holderName}</td>
                <td>
                  {g.resourceName}
                  {g.gpuCount ? <div className="small">{g.gpuCount}× H100</div> : null}
                </td>
                <td><Chips items={g.purposes} /></td>
                <td><Chips items={g.controls} /></td>
                <td>
                  <Status value={g.status} />
                  {g.status === "active" && <div className="small">{remaining(g.remainingMs)}</div>}
                  {g.status === "revoked" && <div className="small">by {g.revokedByName}: “{g.revokeReason}”</div>}
                </td>
                <td className="small">
                  {when(g.startsAt)} →<br />
                  {when(g.expiresAt)}
                </td>
                <td>
                  {canRevoke && g.status === "active" && (
                    <button className="danger" onClick={() => revoke(g)}>
                      Emergency revoke
                    </button>
                  )}
                  {g.holderSub === user.sub && (g.status === "active" || g.status === "expired") && (
                    <button className="ghost" onClick={() => ctx.startExtension(g)}>
                      Need more time?
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Receipt result={result} />
    </>
  );
}

function UseConsole({ grant, ctx }) {
  const { meta } = ctx;
  const compute = grant.resourceType === "compute";
  const [purpose, setPurpose] = useState(grant.purposes[0]);
  const [input, setInput] = useState("Score this fake transcript");
  const [job, setJob] = useState({ gpus: grant.gpuCount ?? 1, image: meta.images[0], hours: 6 });
  const [result, setResult] = useState(null);

  async function run() {
    const res = compute
      ? await api("/api/jobs", { method: "POST", body: { credential: grant.credential, purpose, gpus: Number(job.gpus), image: job.image, hours: Number(job.hours) } })
      : await api("/api/use", { method: "POST", body: { credential: grant.credential, resourceId: grant.resourceId, purpose, input } });
    setResult(res);
    ctx.refresh();
  }

  return (
    <section className="card console">
      <div className="item-head">
        <h2>
          Use {grant.resourceName} <span className="small muted">({grant.id})</span>
        </h2>
        <span className="small">{remaining(grant.remainingMs)}</span>
      </div>
      <p className="small">
        Your temporary mock credential: <code>{grant.credential}</code> · approved for <Chips items={grant.purposes} /> · controls <Chips items={grant.controls} />
      </p>
      <div className="row">
        <label>
          Purpose of this call
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {meta.purposes.map((p) => (
              <option key={p} value={p}>
                {p} {grant.purposes.includes(p) ? "" : "(not approved)"}
              </option>
            ))}
          </select>
        </label>
        {compute ? (
          <>
            <label>
              GPUs
              <input type="number" min="1" max="8" value={job.gpus} onChange={(e) => setJob({ ...job, gpus: e.target.value })} />
            </label>
            <label>
              Image
              <select value={job.image} onChange={(e) => setJob({ ...job, image: e.target.value })}>
                {[...meta.images, "random/crypto-miner:latest"].map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </label>
            <label>
              Hours
              <input type="number" min="1" max="72" value={job.hours} onChange={(e) => setJob({ ...job, hours: e.target.value })} />
            </label>
          </>
        ) : (
          <label className="grow">
            Input
            <input value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
        )}
      </div>
      <button className="button" onClick={run}>
        {compute ? "Submit mock job" : "Call mock resource"}
      </button>
      <Receipt result={result} />
      {result?.ok && result.data.output && (
        <div className="output">
          <div className="output-banner">{result.data.banner}</div>
          <pre>{JSON.stringify(result.data.output, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
