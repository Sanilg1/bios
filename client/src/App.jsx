import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { Login } from "./views/Login.jsx";
import { MyAccessView } from "./views/MyAccessView.jsx";
import { HistoryView } from "./views/HistoryView.jsx";
import { BreakItView } from "./views/BreakItView.jsx";
import { AdminView } from "./views/AdminView.jsx";
import { DASHBOARDS, Dashboard, dashboardCount } from "./views/Dashboards.jsx";

// One independent dashboard per role. A tab appears only for a role you hold; the server
// enforces the same rule (R11) for anyone who opens a dashboard link directly.
const TABS = [
  { id: "access", label: "My access", role: "requester" },
  ...DASHBOARDS.map((d) => ({ id: d.id, label: d.label, role: d.id, dashboard: true })),
  { id: "admin", label: "Admin", role: "admin" },
  { id: "history", label: "History" },
  { id: "breakit", label: "Try to break it" },
];
const HOUR_MS = 60 * 60 * 1000;

export function App() {
  const [session, setSession] = useState(null);
  const [tab, setTabState] = useState(() => tabFromHash());
  const [data, setData] = useState({ meta: null, resources: [], requests: [], grants: [], jobs: [], dashboards: {} });
  const [extendFrom, setExtendFrom] = useState(null);
  // Reviewer roles of the signed-in user, so refresh() only asks for dashboards they can open.
  const rolesRef = useRef([]);

  // Each tab has its own link (#manager, #risk, #owner, …) so a reviewer can open their dashboard directly.
  const setTab = useCallback((id) => {
    setTabState(id);
    if (window.location.hash !== `#${id}`) window.location.hash = id;
  }, []);
  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const loadSession = useCallback(async () => {
    const res = await api("/api/session");
    const next = res.data ?? { authenticated: false };
    rolesRef.current = next.user?.roles ?? [];
    setSession(next);
  }, []);

  const refresh = useCallback(async () => {
    const reviewerRoles = DASHBOARDS.map((d) => d.id).filter((role) => rolesRef.current.includes(role));
    const paths = ["/api/meta", "/api/resources", "/api/requests", "/api/grants", "/api/jobs", ...reviewerRoles.map((role) => `/api/dashboards/${role}`)];
    const [meta, resources, requests, grants, jobs, ...boards] = await Promise.all(paths.map((p) => api(p)));
    if (meta.status === 401) {
      setSession({ authenticated: false });
      return;
    }
    const dashboards = Object.fromEntries(reviewerRoles.map((role, i) => [role, boards[i].ok ? boards[i].data : null]));
    setData({ meta: meta.data, resources: resources.data, requests: requests.data, grants: grants.data, jobs: jobs.data, dashboards });
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!session?.authenticated) return;
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [session?.authenticated, refresh]);

  async function signOut() {
    const res = await api("/api/auth/logout", { method: "POST" });
    window.location.assign(res.data?.logoutUrl ?? "/");
  }

  if (!session) return <Shell><p className="muted pad">Loading…</p></Shell>;
  if (!session.authenticated) return <Shell><Login /></Shell>;

  const user = session.user;
  const ctx = {
    user,
    ...data,
    demoMode: session.demoMode,
    via: session.via,
    refresh: async () => {
      await loadSession();
      await refresh();
    },
    startExtension: (grant) => {
      setExtendFrom(grant);
      setTab("access");
    },
  };

  return (
    <Shell>
      <section className="userbar">
        <div>
          <strong>{user.name}</strong>
          <span className={`via via-${session.via}`}>{session.via === "namoid" ? "signed in via NamoID" : "dev login (not NamoID)"}</span>
          <span className="roles">
            {user.roles.map((r) => (
              <span key={r} className="chip">{r}</span>
            ))}
          </span>
        </div>
        <div className="userbar-right">
          <button className="ghost" onClick={signOut}>Sign out</button>
        </div>
      </section>
      {data.meta && Math.abs(data.meta.now - Date.now()) > HOUR_MS && (
        <p className="note" role="note">
          Simulated time is on: the app thinks it is <strong>{new Date(data.meta.now).toLocaleString()}</strong>. An operator moved the clock to
          demonstrate expiry; the jump is in the history.
        </p>
      )}
      <nav className="tabs">
        {visibleTabs(user).map((t) => {
          const count = t.dashboard ? dashboardCount(data.dashboards[t.id]) : 0;
          return (
            <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
              {count > 0 && <span className="badge" aria-label={`${count} waiting`}>{count}</span>}
            </button>
          );
        })}
      </nav>
      <div className="view">
        {!data.meta ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {tab === "access" && <MyAccessView ctx={ctx} extendFrom={extendFrom} clearExtend={() => setExtendFrom(null)} />}
            {DASHBOARDS.some((d) => d.id === tab) && <Dashboard key={tab} role={tab} ctx={ctx} />}
            {tab === "admin" && <AdminView ctx={ctx} />}
            {tab === "history" && <HistoryView ctx={ctx} />}
            {tab === "breakit" && <BreakItView />}
          </>
        )}
      </div>
    </Shell>
  );
}

function visibleTabs(user) {
  return TABS.filter((t) => !t.role || user.roles.includes(t.role));
}

// A dashboard link for a role you don't hold still opens: the dashboard shows the server's refusal.
function tabFromHash() {
  const id = window.location.hash.slice(1);
  return TABS.some((t) => t.id === id) ? id : "access";
}

function Shell({ children }) {
  return (
    <>
      <header className="top">
        <a className="program" href="https://namoid.in">Powered by namo<span>id</span></a>
        <span className="product">Responsible AI Access Gate · Team Netra</span>
        <span className="independent">Independent community build</span>
      </header>
      <div className="banner" role="note">
        All models, datasets, credentials, GPUs and outputs here are <strong>mock</strong>. Approval authorizes use under stated conditions; it does <strong>not</strong> make use safe.
      </div>
      <main className="app">{children}</main>
      <footer>
        <p>
          <strong><a href="https://namoid.in">Powered by NamoID</a></strong> · <a href="https://docs.namoid.in">Documentation</a> ·{" "}
          <a href="https://challenges.namoid.in">Engineering Challenges</a> · <a href="https://github.com/Sanilg1/bios">Source</a>
        </p>
        <p>Contributor-owned · Not an official NamoID product</p>
      </footer>
    </>
  );
}
