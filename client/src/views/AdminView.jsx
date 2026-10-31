import { useEffect, useState } from "react";
import { api, when } from "../api.js";
import { Chips, Receipt } from "../ui.jsx";

// The operator's page: who has signed in and what they may do. Roles are read-only here: they
// come from the role directory (ROLE_DIRECTORY), so nobody can grant a role from the browser.
export function AdminView({ ctx }) {
  const [people, setPeople] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api("/api/admin/people").then((res) => (res.ok ? setPeople(res.data) : setResult(res)));
  }, [ctx.requests]);

  async function advance(hours) {
    const res = await api("/api/demo/clock", { method: "POST", body: { hours } });
    setResult(res.ok ? { ok: true, data: { receipt: `App time is now ${new Date(res.data.now).toLocaleString()}. This jump is in the history.` } } : res);
    ctx.refresh();
  }

  return (
    <div>
      <section className="card">
        <h2>People</h2>
        <p className="small muted">
          Everyone who has signed in through NamoID. Each person is identified by their NamoID ID. Reviewer roles come from the role directory matched on a
          NamoID-verified email; everyone else can only request access.
        </p>
        {people && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>NamoID ID</th>
                  <th>Roles</th>
                  <th>Owns</th>
                  <th>First seen</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.sub}>
                    <td>
                      <strong>{p.name}</strong>
                      {p.email && <div className="small muted">{p.email}</div>}
                    </td>
                    <td><code>{p.sub.slice(0, 12)}{p.sub.length > 12 ? "…" : ""}</code></td>
                    <td><Chips items={p.roles} /></td>
                    <td className="small">{p.owns.length ? `${p.owns.length} resource(s)` : "—"}</td>
                    <td className="small">{p.firstSeenAt ? when(p.firstSeenAt) : "sample data"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {ctx.demoMode && (
        <section className="card">
          <h2>Simulated time</h2>
          <p className="small">
            For demonstrations only: move the app's clock forward to show grants expiring and jobs stopping without waiting days. Everyone sees the
            simulated time, and every jump is logged.
          </p>
          <div className="btns">
            <button onClick={() => advance(1)}>+1 hour</button>
            <button onClick={() => advance(24)}>+1 day</button>
            <button onClick={() => advance(24 * 8)}>+8 days</button>
          </div>
        </section>
      )}
      <Receipt result={result} />
    </div>
  );
}
