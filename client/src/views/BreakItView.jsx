import { useEffect, useState } from "react";
import { api } from "../api.js";

export function BreakItView() {
  const [attacks, setAttacks] = useState([]);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null);

  useEffect(() => {
    api("/api/breakit").then((res) => res.ok && setAttacks(res.data));
  }, []);

  async function run(id) {
    setRunning(id);
    const res = await api(`/api/breakit/${id}`, { method: "POST" });
    setResults((r) => ({ ...r, [id]: res.data }));
    setRunning(null);
  }

  async function runAll() {
    for (const a of attacks) await run(a.id);
  }

  const done = Object.values(results);
  const blocked = done.filter((r) => r.blocked).length;

  return (
    <div>
      <section className="card">
        <div className="item-head">
          <h2>Try to break it</h2>
          <button className="button" onClick={runAll} disabled={Boolean(running)}>
            Run all {attacks.length} attacks
          </button>
        </div>
        <p>
          Each attack runs against a <strong>fresh sandbox copy of this app</strong>: same HTTP routes, same policy engine, its own data and clock. Fictional
          personas play each role. Nothing here touches your real grants. Every attack also exists as an automated test.
        </p>
        {done.length > 0 && (
          <p className={blocked === done.length ? "allowed-text" : "denied-text"}>
            <strong>
              {blocked} / {done.length} blocked
            </strong>
          </p>
        )}
      </section>
      <div className="attacks">
        {attacks.map((a) => {
          const r = results[a.id];
          return (
            <article key={a.id} className={`card attack ${r ? (r.blocked ? "blocked" : "breached") : ""}`}>
              <div className="item-head">
                <h3>{a.title}</h3>
                <span className="rule">{a.rule}</span>
              </div>
              <p className="small">{a.tries}</p>
              <button onClick={() => run(a.id)} disabled={Boolean(running)}>
                {running === a.id ? "Running…" : r ? "Run again" : "Attack"}
              </button>
              {r && (
                <>
                  <div className={`receipt ${r.blocked ? "denied" : "allowed"}`}>
                    <span className="receipt-tag">{r.blocked ? `BLOCKED · HTTP ${r.final.status}` : "NOT BLOCKED"}</span>
                    <span>{r.final.receipt}</span>
                  </div>
                  <details>
                    <summary>Show the {r.transcript.length} HTTP steps</summary>
                    <ol className="transcript">
                      {r.transcript.map((step, i) =>
                        step.note ? (
                          <li key={i} className="muted">{step.note}</li>
                        ) : (
                          <li key={i}>
                            <code>
                              {step.actor}: {step.method} {step.path} → {step.status}
                            </code>
                            {step.response?.receipt && <div className="small">{step.response.receipt}</div>}
                          </li>
                        ),
                      )}
                    </ol>
                  </details>
                </>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
