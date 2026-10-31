import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { namoidProvider } from "../server/auth/namoid.js";
import { snapshotter } from "../server/store.js";

// A stand-in for the NamoID SDK that rotates refresh tokens and counts refresh calls.
function fakeNamoid() {
  const calls = [];
  return {
    calls,
    hostedAuth: {
      async refresh({ refreshToken }) {
        calls.push(refreshToken);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { access_token: `at-${calls.length}`, refresh_token: `${refreshToken}-next`, expires_in: 900 };
      },
    },
  };
}

function expiringRequest(refreshToken) {
  return {
    session: {
      namoidAuth: { tokens: { refresh_token: refreshToken, id_token: "id" }, userId: "sub-1", displayName: "Test", expiresAt: Date.now() - 1 },
      save: (done) => done(),
    },
  };
}

describe("NamoID session refresh", () => {
  test("parallel requests near expiry share one refresh, so a rotating provider sees each refresh token once", async () => {
    const namoid = fakeNamoid();
    const provider = namoidProvider({ clientId: "test", clientSecret: "secret", namoid });
    const requests = Array.from({ length: 5 }, () => expiringRequest("rt-1"));
    const identities = await Promise.all(requests.map((req) => provider.identify(req)));
    assert.deepEqual(namoid.calls, ["rt-1"]);
    assert.ok(identities.every((id) => id?.sub === "sub-1"));
    assert.ok(requests.every((req) => req.session.namoidAuth.tokens.refresh_token === "rt-1-next"));

    // A request that loaded the session before it was re-saved still gets the shared result.
    const late = expiringRequest("rt-1");
    assert.equal((await provider.identify(late))?.sub, "sub-1");
    assert.deepEqual(namoid.calls, ["rt-1"]);
  });

  test("a failed refresh ends the session and isn't cached", async () => {
    let attempts = 0;
    const namoid = { hostedAuth: { refresh: async () => { attempts += 1; throw new Error("invalid_grant"); } } };
    const provider = namoidProvider({ clientId: "test", clientSecret: "secret", namoid });
    const errors = console.error;
    console.error = () => {};
    try {
      const req = expiringRequest("rt-bad");
      assert.equal(await provider.identify(req), null);
      assert.equal(req.session.namoidAuth, undefined);
      assert.equal(await provider.identify(expiringRequest("rt-bad")), null);
      assert.equal(attempts, 2);
    } finally {
      console.error = errors;
    }
  });
});

describe("state snapshots", () => {
  test("a failing snapshot write is logged, not thrown, so it can't crash the gate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "netra-snap-"));
    const notADir = join(dir, "file");
    writeFileSync(notADir, "x");
    const save = snapshotter(join(notADir, "state.json"));
    const logged = [];
    const errors = console.error;
    console.error = (message) => logged.push(message);
    try {
      save({ audit: [] });
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      console.error = errors;
    }
    assert.equal(logged.length, 1);
    assert.match(logged[0], /State snapshot to .+ failed/);
  });
});

describe("NamoID callback diagnostics", () => {
  test("a failed callback says exactly why, without reflecting arbitrary input", async () => {
    const express = (await import("express")).default;
    const session = (await import("express-session")).default;
    const namoid = {
      hostedAuth: {
        async start({ redirectUri }) {
          return { authorizationUrl: "https://namoid.example/authorize", transaction: { state: "s-1", nonce: "n", codeVerifier: "v", redirectUri, createdAt: Date.now() } };
        },
      },
    };
    const app = express();
    app.use(session({ secret: "x".repeat(32), resave: false, saveUninitialized: false }));
    namoidProvider({ clientId: "test", clientSecret: "secret", namoid }).mount(app, { appBaseUrl: "http://127.0.0.1" });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const errors = console.error;
    console.error = () => {};
    try {
      const callback = async (query, cookie) => {
        const res = await fetch(`${base}/api/auth/callback?${query}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
        return new URL(res.headers.get("location"), base).searchParams.get("auth_error");
      };
      assert.equal(await callback("error=access_denied&state=s-1"), "namoid_access_denied");
      assert.equal(await callback("error=%3Cscript%3E"), "namoid_error", "odd error values never reach the URL");
      assert.equal(await callback("state=s-1"), "no_code");
      assert.equal(await callback("code=c&state=s-1"), "no_transaction");

      const login = await fetch(`${base}/api/auth/login`, { method: "POST" });
      const cookie = login.headers.get("set-cookie").split(";")[0];
      assert.equal(await callback("code=c&state=wrong", cookie), "state_mismatch");
    } finally {
      console.error = errors;
      server.close();
    }
  });
});
