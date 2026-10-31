import { useEffect, useState } from "react";
import { api } from "../api.js";

export function Login() {
  const [options, setOptions] = useState(null);
  const [error, setError] = useState(null);
  const authError = new URLSearchParams(window.location.search).get("auth_error");

  useEffect(() => {
    api("/api/auth/options").then((res) => setOptions(res.data));
  }, []);

  async function namoidSignIn() {
    setError(null);
    const res = await api("/api/auth/login", { method: "POST" });
    if (res.ok && res.data?.authorizationUrl) window.location.assign(res.data.authorizationUrl);
    else setError(res.data?.error ?? "Could not start sign-in.");
  }

  async function devSignIn(sub) {
    await api("/api/auth/dev-login", { method: "POST", body: { sub } });
    window.location.assign("/");
  }

  return (
    <section className="login">
      <p className="eyebrow">responsible-ai-access-gate</p>
      <h1>No permanent keys.</h1>
      <p className="lede">
        Ask for a mock model, dataset or H100 time with a purpose, a duration and risk controls. Three reviewers decide. Access expires on its own, works
        only for what was approved, and can be killed instantly.
      </p>
      {authError && <p className="receipt denied">Sign-in didn't complete ({authError}). Please try again.</p>}
      {error && <p className="receipt denied">{error}</p>}
      <div className="actions">
        <button className="button" onClick={namoidSignIn} disabled={options && !options.namoid}>
          Sign in with NamoID
        </button>
        {options && !options.namoid && <span className="muted">NamoID isn't configured on this server yet.</span>}
      </div>
      {options?.devLogin && (
        <div className="devlogin">
          <p>
            <strong>Dev login</strong> — local development only, not NamoID. Refused in production.
          </p>
          <div className="personas">
            {options.personas.map((p) => (
              <button key={p.sub} className="persona" onClick={() => devSignIn(p.sub)}>
                <strong>{p.name}</strong>
                <span>{p.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
