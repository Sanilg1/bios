import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { Login } from "./views/Login.jsx";
import { RequestView } from "./views/RequestView.jsx";
import { ReviewView } from "./views/ReviewView.jsx";
import { GrantsView } from "./views/GrantsView.jsx";
import { HistoryView } from "./views/HistoryView.jsx";
import { BreakItView } from "./views/BreakItView.jsx";
import { DemoView } from "./views/DemoView.jsx";

const TABS = [
  { id: "request", label: "Request access" },
  { id: "review", label: "Review queue" },
  { id: "grants", label: "Grants & use" },
  { id: "history", label: "History" },
  { id: "breakit", label: "Try to break it" },
  { id: "demo", label: "Demo controls", demoOnly: true },
];

export function App() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("request");
  const [data, setData] = useState({ meta: null, resources: [], requests: [], grants: [], jobs: [] });
  const [extendFrom, setExtendFrom] = useState(null);

  const loadSession = useCallback(async () => {
    const res = await api("/api/session");
    setSession(res.data ?? { authenticated: false });
  }, []);

  const refresh = useCallback(async () => {
    const [meta, resources, requests, grants, jobs] = await Promise.all(
      ["/api/meta", "/api/resources", "/api/requests", "/api/grants", "/api/jobs"].map((p) => api(p)),
    );
    if (meta.status === 401) {
      setSession({ authenticated: false });
      return;
    }
    setData({ meta: meta.data, resources: resources.data, requests: requests.data, grants: grants.data, jobs: jobs.data });
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
    refresh: async () => {
      await refresh();
      await loadSession();
    },
    startExtension: (grant) => {
      setExtendFrom(grant);
      setTab("request");
    },
  };

  return (
    <Shell>
      <section className="userbar">
        <div>
          <strong>{user.name}</strong>
          <span className={`via via-${session.via}`}>{session.via === "namoid" ? "signed in via NamoID" : "dev login (not NamoID)"}</span>
          <span className="roles">
            {user.roles.length ? user.roles.map((r) => <span key={r} className="chip">{r}</span>) : <span className="chip warn">no roles yet</span>}
          </span>
        </div>
        <div className="userbar-right">
          {session.demoMode && data.meta && <span className="clock">Demo clock: {new Date(data.meta.now).toLocaleString()}</span>}
          <button className="ghost" onClick={signOut}>Sign out</button>
        </div>
      </section>
      <nav className="tabs">
        {TABS.filter((t) => !t.demoOnly || session.demoMode).map((t) => (
          <button key={t.id} className={tab === t.id ? "tab active" : "tab"} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="view">
        {!data.meta ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {tab === "request" && <RequestView ctx={ctx} extendFrom={extendFrom} clearExtend={() => setExtendFrom(null)} />}
            {tab === "review" && <ReviewView ctx={ctx} />}
            {tab === "grants" && <GrantsView ctx={ctx} />}
            {tab === "history" && <HistoryView ctx={ctx} />}
            {tab === "breakit" && <BreakItView />}
            {tab === "demo" && session.demoMode && <DemoView ctx={ctx} />}
          </>
        )}
      </div>
    </Shell>
  );
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
