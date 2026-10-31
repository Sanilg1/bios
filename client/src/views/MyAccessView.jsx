import { Chips, ScoreCard } from "../ui.jsx";
import { GrantTable, JobsList, UseConsole } from "./GrantsView.jsx";
import { MyRequests, RequestForm } from "./RequestView.jsx";

// The requester's dashboard. Everyone who signs in has one. The server only ever sends this
// person's own requests, grants and jobs here, so nothing on this page belongs to anyone else.
export function MyAccessView({ ctx, extendFrom, clearExtend }) {
  const { user, requests, grants, jobs } = ctx;
  const mine = (list, key) => list.filter((x) => x[key] === user.sub);
  const myGrants = mine(grants, "holderSub");
  const live = myGrants.filter((g) => g.status === "active" || g.status === "scheduled");
  const ended = myGrants.filter((g) => g.status === "expired" || g.status === "revoked");

  return (
    <div>
      <Profile ctx={ctx} />

      <div className="grid two">
        <RequestForm ctx={ctx} extendFrom={extendFrom} clearExtend={clearExtend} />
        <MyRequests requests={mine(requests, "requesterSub")} />
      </div>

      {live.filter((g) => g.status === "active").map((g) => (
        <UseConsole key={g.id} grant={g} ctx={ctx} />
      ))}

      <section className="card">
        <h2>My access</h2>
        <GrantTable grants={live} ctx={ctx} empty="No active access. Approved requests appear here." />
      </section>

      {myGrants.some((g) => g.resourceType === "compute") && (
        <section className="card">
          <h2>My mock H100 jobs</h2>
          <JobsList jobs={mine(jobs, "holderSub")} />
        </section>
      )}

      {ended.length > 0 && (
        <section className="card">
          <h2>Ended access</h2>
          <GrantTable grants={ended} ctx={ctx} empty="None." />
        </section>
      )}
    </div>
  );
}

// Who you are (from NamoID), what you may do, and your confidence score with its reasons.
function Profile({ ctx }) {
  const { user, via } = ctx;
  return (
    <section className="card profile">
      <div className="profile-id">
        <h2>{user.name}</h2>
        <p className="small muted">
          {user.email && <>{user.email} · </>}
          {via === "namoid" ? "signed in through NamoID" : "local dev login"} · NamoID ID <code>{user.sub.slice(0, 8)}…</code>
        </p>
        <p className="small">
          Roles: <Chips items={user.roles} />
        </p>
        <p className="small muted">Reviewer roles come from your organisation's role directory. You can't give yourself a role.</p>
      </div>
      <ScoreCard sub={user.sub} />
    </section>
  );
}
