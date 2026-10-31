import { useState } from "react";
import { api } from "../api.js";
import { Receipt } from "../ui.jsx";

const ROLE_HELP = {
  requester: "Ask for access (student / researcher)",
  manager: "Faculty guide / PI: confirms the need",
  risk: "IT security or ethics: narrows, adds controls, can emergency-revoke",
  owner: "HPC / lab admin: owns the mock resources, can revoke on them",
};

export function DemoView({ ctx }) {
  const { user, meta } = ctx;
  const [roles, setRoles] = useState(user.roles);
  const [result, setResult] = useState(null);

  async function saveRoles() {
    const res = await api("/api/demo/roles", { method: "POST", body: { roles } });
    setResult(res.ok ? { ok: true, data: { receipt: `Your roles are now: ${res.data.roles.join(", ") || "none"}. Separation of duties still applies per request.` } } : res);
    ctx.refresh();
  }

  async function advance(hours) {
    const res = await api("/api/demo/clock", { method: "POST", body: { hours } });
    setResult(res.ok ? { ok: true, data: { receipt: `Demo clock is now ${new Date(res.data.now).toLocaleString()}. This is logged in the history.` } } : res);
    ctx.refresh();
  }

  return (
    <div className="grid two">
      <section className="card">
        <h2>Your demo roles</h2>
        <p className="small">
          Demo mode only. In a real deployment roles would come from an admin-managed table keyed by your NamoID <code>sub</code>. Try giving yourself
          every role, then approving your own request: separation of duties still stops you (R1).
        </p>
        {meta.roles.map((role) => (
          <label key={role} className="check block">
            <input type="checkbox" checked={roles.includes(role)} onChange={() => setRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]))} />{" "}
            <strong>{role}</strong> — <span className="muted">{ROLE_HELP[role]}</span>
          </label>
        ))}
        <button className="button" onClick={saveRoles}>Save roles</button>
        <p className="small muted">Your NamoID subject id: <code>{user.sub}</code></p>
      </section>
      <section className="card">
        <h2>Demo clock</h2>
        <p className="small">Moves this server's clock forward so you can watch grants expire and jobs die. Demo-only, never in production, and every jump is logged.</p>
        <div className="btns">
          <button onClick={() => advance(1)}>+1 hour</button>
          <button onClick={() => advance(24)}>+1 day</button>
          <button onClick={() => advance(24 * 8)}>+8 days</button>
        </div>
        <p className="small">Now: {new Date(meta.now).toLocaleString()}</p>
      </section>
      <Receipt result={result} />
    </div>
  );
}
