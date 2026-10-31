// Shared Playwright helpers for the end-to-end NamoID scripts.
// Following the NamoID docs, nothing here prints an OTP, an authorization code or a callback URL.
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

if (existsSync(".env")) process.loadEnvFile(".env");

export const BASE = (process.env.E2E_BASE_URL ?? "https://netra-gate.vercel.app").replace(/\/+$/, "");
export const OUT = ".e2e";
mkdirSync(OUT, { recursive: true });

export function launch() {
  return chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: process.env.E2E_HEADED !== "true" });
}

export class E2EFailure extends Error {}

const bodyText = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300);

// Signs a browser page in through the app's "Sign in with NamoID" button and NamoID Hosted Auth.
// getOtp() is called only once NamoID's code screen is showing.
export async function signInWithNamoID(page, { email, getOtp, label = "user", log = () => {} }) {
  const shot = (name) => page.screenshot({ path: `${OUT}/${label}-${name}.png`, fullPage: true });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const signIn = page.getByRole("button", { name: "Sign in with NamoID" });
  await signIn.waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector("button.button")?.disabled, null, { timeout: 30_000 }).catch(() => {});
  await signIn.click();
  await page.waitForURL((url) => url.hostname.endsWith(".namoid.in"), { timeout: 30_000 }).catch(() => {
    throw new E2EFailure("The app did not send the browser to NamoID.");
  });
  log(`on NamoID Hosted Auth (${new URL(page.url()).hostname})`);
  const emailField = page.locator("#email-identifier, input[type=email], input[name=email]").first();
  await emailField.waitFor({ timeout: 30_000 });
  await shot("1-namoid-email");
  if (!email) return { reachedNamoID: true };

  await emailField.fill(email);
  await page.locator("#identifier-form button[type=submit], button[type=submit]").first().click();

  // NamoID shows "Check your email … 6-digit code" with six single-digit boxes (or one code field).
  await page.getByText(/6-digit code|verification code|enter the code/i).first().waitFor({ timeout: 30_000 }).catch(async () => {
    throw new E2EFailure(`No code screen appeared after the email. NamoID says: “${await bodyText(page)}”`);
  });
  await shot("2-namoid-code");
  const otp = await getOtp();
  if (!otp) throw new E2EFailure("No sign-in code available.");
  const single = page.locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i]').first();
  if (await single.isVisible().catch(() => false)) {
    await single.fill(otp);
  } else {
    await page.locator("input[type=text]:visible").first().click();
    await page.keyboard.type(otp, { delay: 60 });
  }
  log("code entered");
  const submit = page.locator("button[type=submit]:visible").first();
  if (await submit.count()) await submit.click({ timeout: 5_000 }).catch(() => {});

  // Some instances show a consent or "continue" screen before redirecting back.
  const appOrigin = new URL(BASE).origin;
  const deadline = Date.now() + 60_000;
  while (new URL(page.url()).origin !== appOrigin && Date.now() < deadline) {
    const proceed = page.getByRole("button", { name: /allow|continue|accept|authori[sz]e|confirm/i }).first();
    if (await proceed.isVisible().catch(() => false)) {
      log(`clicking NamoID's “${(await proceed.innerText()).trim()}”`);
      await proceed.click().catch(() => {});
    }
    await page.waitForTimeout(1000);
  }
  if (new URL(page.url()).origin !== appOrigin) throw new E2EFailure(`NamoID never redirected back. It says: “${await bodyText(page)}”`);
  const authError = new URL(page.url()).searchParams.get("auth_error");
  if (authError) throw new E2EFailure(`Back at the app, but sign-in failed with auth_error=${authError}.`);
  await page.getByText("signed in via NamoID").waitFor({ timeout: 30_000 }).catch(() => {
    throw new E2EFailure("Back at the app, but it doesn't show a NamoID session.");
  });
  await shot("3-app-signed-in");
  const session = await api(page, "GET", "/api/session");
  return { session: session.body };
}

// Calls the app's API from inside the signed-in page, so the session cookie and Origin are real.
export function api(page, method, path, body) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, path, body },
  );
}
