// The whole product flow, end to end, with four real NamoID test users against a real deployment:
// each person signs in through NamoID Hosted Auth in their own browser, gets their role from the
// operator's role directory (ROLE_DIRECTORY, matched on NamoID-verified email), and the
// reviewers approve from their own dashboards. Then the requester uses the grant, the risk
// reviewer revokes it, and the requester is refused.
//
// Needs the four managed test users in .env (Console → Test → Users → Test users → key icon):
//   NAMOID_TEST_{REQUESTER,MANAGER,RISK,OWNER}_EMAIL and _OTP
// Optional: E2E_BASE_URL, E2E_BROWSER, E2E_HEADED=true. Screenshots go to .e2e/.
import { existsSync } from "node:fs";
import { api, BASE, E2EFailure, launch, OUT, signInWithNamoID } from "./e2e-lib.mjs";

const ROLES = ["requester", "manager", "risk", "owner"];
const DASHBOARD_TAB = { manager: "Manager", risk: "Risk reviewer", owner: "Resource owner" };
const env = (name) => process.env[name]?.trim() || undefined;
const people = ROLES.map((role) => ({ role, email: env(`NAMOID_TEST_${role.toUpperCase()}_EMAIL`), otp: env(`NAMOID_TEST_${role.toUpperCase()}_OTP`) }));
const missing = people.filter((p) => !p.email || !p.otp).map((p) => p.role);
if (missing.length) {
  console.error(`✗ Missing test-user email or code in .env for: ${missing.join(", ")}.\n  Console → Test → Users → Test users → key icon. Codes are valid for one hour.`);
  process.exit(1);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new E2EFailure(name);
};

const browser = await launch();
const pages = {};
let code = 0;
try {
  console.log(`Demo run against ${BASE}\n`);

  // 1. Everyone signs in through NamoID, each in a separate browser context, and takes one role.
  // A session from an earlier run (saved in .e2e/, git-ignored) is reused while the app still
  // accepts it, so repeated runs don't hit NamoID's sign-in rate limit.
  for (const person of people) {
    const stateFile = `${OUT}/${person.role}.session.json`;
    const context = await browser.newContext(existsSync(stateFile) ? { storageState: stateFile } : {});
    const page = await context.newPage();
    pages[person.role] = page;
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
    let session = (await api(page, "GET", "/api/session")).body;
    if (session?.authenticated && session.via === "namoid") {
      check(`${person.role} is still signed in through NamoID (session reused)`, true, `NamoID sub ${String(session.user.sub).slice(0, 8)}…`);
    } else {
      ({ session } = await signInWithNamoID(page, { email: person.email, getOtp: async () => person.otp, label: person.role }));
      check(`${person.role} signs in through NamoID Hosted Auth`, session.via === "namoid", `${session.user.name}, NamoID sub ${String(session.user.sub).slice(0, 8)}…`);
      await context.storageState({ path: stateFile });
    }
    check(`${person.role}'s email is verified by NamoID`, session.user.emailVerified === true, session.user.email);
    check(`${person.role} holds the ${person.role} role from the role directory`, session.user.roles.includes(person.role), session.user.roles.join(", "));
    const pick = await api(page, "POST", "/api/demo/roles", { roles: ["risk", "owner", "manager"] });
    check(`${person.role} can't give themselves other roles`, pick.status === 404);
    person.sub = session.user.sub;
  }

  // 2. Roles are enforced by the server: the manager can't open the owner dashboard, and the
  // requester sees only their own data.
  const locked = await api(pages.manager, "GET", "/api/dashboards/owner");
  check("manager is refused the owner dashboard", locked.status === 403 && locked.body?.rule === "R11", "R11");
  const others = await api(pages.requester, "GET", "/api/grants");
  check("requester sees only their own grants", others.status === 200 && others.body.every((g) => g.holderSub === people[0].sub), `${others.body.length} grant(s)`);

  // 3. The requester asks for access, and can't approve it themselves.
  const created = await api(pages.requester, "POST", "/api/requests", {
    resourceId: "model:sentinel-eval-mock",
    purposes: ["Evaluate refusal behaviour on synthetic prompts"],
    durationDays: 3,
    controls: ["no-export"],
    justification: `Playwright end-to-end run ${new Date().toISOString().slice(0, 16)}Z`,
  });
  check("requester submits a request", created.status === 201, created.body?.request?.id);
  const requestId = created.body.request.id;
  const self = await api(pages.requester, "POST", `/api/requests/${requestId}/reviews`, { slot: "manager", decision: "approve", reason: "mine" });
  check("requester can't approve their own request", self.status === 403 && self.body?.rule === "R1", "R1");

  // 4. Each reviewer approves from their own dashboard, by clicking in the UI.
  for (const role of ["manager", "risk", "owner"]) {
    const page = pages[role];
    await page.getByRole("button", { name: new RegExp(DASHBOARD_TAB[role]) }).click();
    const card = page.locator("section.card.review", { hasText: requestId }).first();
    await card.waitFor({ timeout: 30_000 });
    await card.getByPlaceholder("Reason (required)").fill(`Approved by the ${role} in the Playwright run`);
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    // The card leaves "waiting on you" once decided; the dashboard keeps the receipt.
    const receipt = page.locator(".dash-receipt .receipt");
    await receipt.waitFor({ timeout: 15_000 });
    await page.screenshot({ path: `${OUT}/${role}-4-dashboard-approved.png`, fullPage: true });
    check(`${role} approves from the ${DASHBOARD_TAB[role]} dashboard`, (await receipt.getAttribute("class")).includes("allowed"));
  }

  // 5. The grant exists, works for its purpose only, and dies on emergency revoke.
  const grants = await api(pages.requester, "GET", "/api/grants");
  const grant = grants.body.find((g) => g.requestId === requestId);
  check("a grant is issued after all three approvals", grant?.status === "active", grant?.id);
  const use = (purpose) => api(pages.requester, "POST", "/api/use", { credential: grant.credential, resourceId: grant.resourceId, purpose, input: "e2e" });
  const ok = await use("evaluate REFUSAL behaviour on synthetic prompts");
  check("requester uses it for the approved purpose", ok.status === 200 && ok.body.receipt.includes("does not mean the use is safe"));
  const wrong = await use("Fine-tune a chatbot on its outputs");
  check("use for another purpose is refused", wrong.status === 403 && wrong.body?.rule === "R4", "R4");

  const risk = pages.risk;
  await risk.getByRole("button", { name: /Risk reviewer/ }).click();
  const row = risk.locator("tr", { hasText: grant.id }).first();
  await row.waitFor({ timeout: 30_000 });
  risk.once("dialog", (dialog) => dialog.accept("Playwright run: emergency revoke"));
  await row.getByRole("button", { name: "Emergency revoke" }).click();
  await risk.waitForTimeout(1500);
  await risk.screenshot({ path: `${OUT}/risk-5-revoked.png`, fullPage: true });
  const after = await use("Evaluate refusal behaviour on synthetic prompts");
  check("after emergency revoke, use is refused", after.status === 403 && after.body?.rule === "R7", "R7");

  console.log(`\n✓ All ${results.length} checks passed with four real NamoID test users. Screenshots in ${OUT}/.`);
} catch (error) {
  for (const [role, page] of Object.entries(pages)) await page.screenshot({ path: `${OUT}/${role}-failure.png`, fullPage: true }).catch(() => {});
  if (!(error instanceof E2EFailure) || !results.some((r) => !r.ok)) console.error(`✗ ${error.message.split("\n")[0]}`);
  console.error(`  Screenshots: ${OUT}/*-failure.png`);
  code = 1;
}
await browser.close();
process.exit(code);
