import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Receipt, Status } from "../ui.jsx";
import { ReviewCard } from "./ReviewCard.jsx";
import { GrantTable } from "./GrantsView.jsx";
import { SlotSummary } from "./RequestView.jsx";

// The three reviewer dashboards. The server builds each one (GET /api/dashboards/:role) and
// refuses it with R11 unless the NamoID-signed-in user holds that role.
export const DASHBOARDS = [
  { id: "manager", label: "Manager", title: "Manager dashboard", who: "Faculty guide / line manager", job: "Is this the right work for this person, for this long?" },
  { id: "risk", label: "Risk reviewer", title: "Risk reviewer dashboard", who: "IT security / ethics", job: "Are the controls enough, and is anything going wrong right now?" },
  { id: "owner", label: "Resource owner", title: "Resource owner dashboard", who: "HPC admin / dataset owner", job: "Can my resource take this, and who is on it now?" },
];

export function Dashboard({ role, ctx }) {
  const info = DASHBOARDS.find((d) => d.id === role);
  const data = ctx.dashboards[role];
  if (!ctx.user.roles.includes(role)) return <Locked info={info} />;
  if (data === undefined) return <p className="muted">Loading…</p>;
  if (data === null) return <p className="muted">This dashboard couldn't load. It retries every few seconds.</p>;

  return (
    <div>
      <section className="card dash-head">
        <div>
          <h2>{info.title}</h2>
          <p className="small muted">
            {info.who} · signed in via NamoID as <strong>{ctx.user.name}</strong>. {info.job}
          </p>
        </div>
        <div className="tiles">
          <Tile n={data.actionable.length} label="waiting on you" hot={data.actionable.length > 0} />
          {role === "risk" && <Tile n={data.activeGrants.length} label="live grants" />}
          {role === "risk" && <Tile n={data.runningJobs.length} label="running jobs" />}
          {role === "owner" && <Tile n={data.resources.length} label="resources you own" />}
          {role === "owner" && <Tile n={data.activeGrants.length} label="live grants on them" />}
          <Tile n={data.decidedByYou.length} label="decided by you" />
        </div>
      </section>

      {role === "owner" && <OwnedResources resources={data.resources} />}

      <h3 className="dash-section">Waiting on your {role} decision</h3>
      {data.actionable.length === 0 && <p className="muted">Nothing is waiting on you.</p>}
      {data.actionable.map((r) => (
        <ReviewCard key={r.id} request={r} ctx={ctx} onlySlot={role} />
      ))}

      {data.yours.length > 0 && (
        <>
          <h3 className="dash-section">Your own requests</h3>
          <p className="note">You can't review your own request, even holding this role. The button is still here so you can see the server refuse it (R1).</p>
          {data.yours.map((r) => (
            <ReviewCard key={r.id} request={r} ctx={ctx} mine onlySlot={role} />
          ))}
        </>
      )}

      {data.otherSlot.length > 0 && (
        <>
          <h3 className="dash-section">You already decided another slot on these</h3>
          <p className="note">One person fills one slot per request. Trying again is refused (R2).</p>
          {data.otherSlot.map((r) => (
            <ReviewCard key={r.id} request={r} ctx={ctx} onlySlot={role} />
          ))}
        </>
      )}

      {role === "risk" && (
        <>
          <section className="card">
            <h2>Live grants</h2>
            <p className="small muted">Emergency revoke works on any grant and stops running jobs at once.</p>
            <GrantTable grants={data.activeGrants} ctx={ctx} empty="No live grants." />
          </section>
          <RecentDenials events={data.recentDenials} />
        </>
      )}

      {role === "owner" && (
        <section className="card">
          <h2>Live grants on your resources</h2>
          <GrantTable grants={data.activeGrants} ctx={ctx} empty="Nobody has access to your resources right now." />
        </section>
      )}

      <section className="card">
        <h2>Decided by you</h2>
        {data.decidedByYou.length === 0 && <p className="muted">You haven't decided anything yet.</p>}
        {data.decidedByYou.map((r) => (
          <article key={r.id} className="item">
            <div className="item-head">
              <span>
                <strong>{r.id}</strong> · {r.requesterName} · {r.resourceName}
              </span>
              <Status value={r.status} />
            </div>
            <SlotSummary request={r} />
          </article>
        ))}
      </section>
    </div>
  );
}

function Tile({ n, label, hot = false }) {
  return (
    <div className={`tile ${hot ? "hot" : ""}`}>
      <span className="tile-n">{n}</span>
      <span className="tile-label">{label}</span>
    </div>
  );
}

function OwnedResources({ resources }) {
  return (
    <section className="card">
      <h2>Your resources</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Type</th>
              <th>Live grants</th>
              <th>GPUs granted</th>
              <th>GPUs running</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.name}</strong></td>
                <td>{r.type}</td>
                <td>{r.liveGrants}</td>
                <td>{r.gpusGranted == null ? "—" : `${r.gpusGranted} of ${r.maxGpus}`}</td>
                <td>
                  {r.gpusRunning == null ? "—" : (
                    <span className="gpu-meter" title={`${r.gpusRunning} of ${r.maxGpus} mock H100s busy`}>
                      <progress max={r.maxGpus} value={r.gpusRunning} /> {r.gpusRunning}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecentDenials({ events }) {
  return (
    <section className="card">
      <h2>Recent denials</h2>
      <p className="small muted">The last refusals across the gate: misuse attempts, self-approvals, out-of-scope jobs.</p>
      {events.length === 0 && <p className="muted">No denials yet.</p>}
      {events.map((e) => (
        <div key={e.seq} className="denial">
          <span className="rule">{e.rule}</span>
          <span className="small muted">{e.at}</span>
          <strong>{e.actorName ?? "anonymous"}</strong>
          <span>{e.receipt.replace(/^Denied \(R\d+\): /, "")}</span>
        </div>
      ))}
    </section>
  );
}

// Shown when the signed-in user lacks the role. It asks the server anyway, so the refusal is real.
function Locked({ info }) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    api(`/api/dashboards/${info.id}`).then(setResult);
  }, [info.id]);
  return (
    <section className="card">
      <h2>{info.title}</h2>
      <p className="muted">
        This dashboard is for the <strong>{info.id}</strong> role. You're signed in through NamoID, but you don't hold that role, so the server won't build it for you.
      </p>
      <Receipt result={result} />
      <p className="small muted">In demo mode you can pick your roles under Demo controls. Every change is logged.</p>
    </section>
  );
}

export function dashboardCount(data) {
  return data ? data.actionable.length : 0;
}

