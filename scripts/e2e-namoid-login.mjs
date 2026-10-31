// End-to-end NamoID Hosted Auth sign-in for one user, driven by Playwright against a real deployment.
//
// Uses a NamoID managed test user (Console → Test → Users → Test users → key icon), from .env:
//   NAMOID_TEST_EMAIL / NAMOID_TEST_OTP, or the requester's NAMOID_TEST_REQUESTER_EMAIL / _OTP.
// For a real inbox, set E2E_EMAIL and E2E_OTP_FILE: the script waits for another process to write
// the emailed code to that file, then deletes it.
// Optional: E2E_BASE_URL, E2E_BROWSER (msedge | chrome), E2E_HEADED=true. Screenshots go to .e2e/.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { api, E2EFailure, launch, OUT, signInWithNamoID } from "./e2e-lib.mjs";

const env = (name) => process.env[name]?.trim() || undefined;
const email = env("E2E_EMAIL") ?? env("NAMOID_TEST_EMAIL") ?? env("NAMOID_TEST_REQUESTER_EMAIL");
const otp = env("NAMOID_TEST_OTP") ?? env("NAMOID_TEST_REQUESTER_OTP");
const otpFile = env("E2E_OTP_FILE");

async function getOtp() {
  if (otp || !otpFile) return otp;
  console.log(`• Waiting up to 5 minutes for the emailed code in ${otpFile}`);
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until) {
    if (existsSync(otpFile)) {
      const code = readFileSync(otpFile, "utf8").trim();
      rmSync(otpFile, { force: true });
      if (/^\d{4,8}$/.test(code)) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

const browser = await launch();
const page = await browser.newPage();
let code = 0;
try {
  const result = await signInWithNamoID(page, {
    email: otp || otpFile ? email : undefined,
    getOtp,
    label: "login",
    log: (message) => console.log(`• ${message}`),
  });
  if (result.reachedNamoID) {
    console.log("\n✓ Reached the NamoID sign-in page. Add a test user's code to .env to finish the login.");
  } else {
    const user = result.session.user;
    console.log(`• Signed in as ${user.name} via ${result.session.via}`);
    if (!user.roles.includes("owner")) {
      const locked = await api(page, "GET", "/api/dashboards/owner");
      if (locked.status !== 403 || locked.body?.rule !== "R11") throw new E2EFailure(`Owner dashboard should refuse a non-owner with R11, got ${locked.status}.`);
      console.log("• Owner dashboard refuses a non-owner (R11) ✓");
    }
    console.log(`\n✓ Full NamoID Hosted Auth sign-in works end to end. Screenshots in ${OUT}/.`);
  }
} catch (error) {
  await page.screenshot({ path: `${OUT}/login-failure.png`, fullPage: true }).catch(() => {});
  console.error(`✗ ${error instanceof E2EFailure ? error.message : error.message.split("\n")[0]}\n  Screenshot: ${OUT}/login-failure.png`);
  code = 1;
}
await browser.close();
process.exit(code);
