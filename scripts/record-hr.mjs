// HR-payroll walkthrough recorder (#144) — one continuous ADMIN flow across the
// employee suite: onboard (salary + a convertible non-monetary benefit) →
// salary advance (request → approve & pay → run salary payout, netted & repaid)
// → non-monetary → cash conversion (convert & withdraw → approve & pay).
//
// The approve-&-pay / salary-run / convert-&-withdraw steps settle through the
// pool rail (real Stellar testnet), so the dev server must run with
// ENABLE_POOL_RAIL=true and a funded STELLAR_SOURCE_SECRET (else those actions
// return a clean 503 and no cash leg is produced). Amounts are kept small.
//
// Needs `pnpm dev` running + a seeded DB (reuses the demo ADMIN).
// Usage: SEED_ADMIN_PASSWORD=... node scripts/record-hr.mjs [out.mp4]
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL || "http://localhost:3000";
const USERNAME = process.env.SEED_ADMIN_USERNAME || "admin";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const OUT_FILE = path.resolve(process.argv[2] || "docs/demo/trexure-hr.mp4");
if (!PASSWORD) throw new Error("SEED_ADMIN_PASSWORD env var required");

// A fresh employee each run (unique name) so the flow always starts clean.
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const EMP_NAME = `Maria Dela Cruz`;
const EMP_EMAIL = `maria.hr+${STAMP}@demo.trexure`;
const POOL_WAIT = 90000; // real testnet deposit/withdraw can take a while

const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), "trexure-hr-"));
const pause = (page, ms) => page.waitForTimeout(ms);

async function smoothScroll(page, px, steps = 24, delay = 45) {
  const per = px / steps;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, per);
    await page.waitForTimeout(delay);
  }
}

const browser = await chromium.launch();

// Warm-up (not recorded): Next dev compiles a route on its first hit, which can
// take 15-30s. Pre-compile the authed pages in a throwaway context — compilation
// is server-global — so the recorded pass is smooth and doesn't stall.
{
  const warm = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const wp = await warm.newPage();
  wp.setDefaultTimeout(60000);
  await wp.goto(`${BASE}/login`);
  await wp.getByLabel("Username").fill(USERNAME);
  await wp.getByLabel("Password").fill(PASSWORD);
  await wp.getByRole("button", { name: "Sign in" }).click();
  await wp.getByRole("heading", { name: "Treasury Overview" }).waitFor();
  await wp.goto(`${BASE}/employees`);
  await wp.goto(`${BASE}/employees/new`);
  await wp.getByRole("heading", { name: "Onboard employee" }).waitFor();
  await warm.close();
  console.log("warm-up done (routes compiled)");
}

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: rawDir, size: { width: 1920, height: 1080 } },
});

// Red click-ripple so viewers can follow the cursor (matches the other recorders).
await context.addInitScript(() => {
  addEventListener(
    "mousedown",
    (e) => {
      const d = document.createElement("div");
      d.style.cssText = [
        "position:fixed",
        `left:${e.clientX - 28}px`,
        `top:${e.clientY - 28}px`,
        "width:56px",
        "height:56px",
        "border:5px solid #e0231e",
        "border-radius:50%",
        "box-shadow:0 0 14px 2px rgba(224,35,30,.75), inset 0 0 8px rgba(224,35,30,.5)",
        "z-index:2147483647",
        "pointer-events:none",
        "transition:transform .55s ease-out, opacity .55s ease-out",
      ].join(";");
      document.documentElement.appendChild(d);
      requestAnimationFrame(() => {
        d.style.transform = "scale(1.7)";
        d.style.opacity = "0";
      });
      setTimeout(() => d.remove(), 700);
    },
    true,
  );
});

const page = await context.newPage();
page.setDefaultTimeout(60000); // absorb any residual dev cold-compile
const t0 = Date.now();
const mark = (label) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);

try {
  // --- Login as the company admin ---
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Username").waitFor();
  await pause(page, 700);
  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);
  await pause(page, 400);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Treasury Overview" }).waitFor({ timeout: 15000 });
  await pause(page, 800);
  mark("logged in");

  // --- Employees list → onboard ---
  await page.goto(`${BASE}/employees`);
  await pause(page, 1400);
  await page.goto(`${BASE}/employees/new`);
  await page.getByRole("heading", { name: "Onboard employee" }).waitFor({ timeout: 15000 });
  await pause(page, 900);

  // Identity
  await page.getByLabel("Name").fill(EMP_NAME);
  await page.getByLabel("Email").fill(EMP_EMAIL);
  await pause(page, 500);
  // Base salary (the pre-filled first row) — small XLM figure keeps the pool legs cheap.
  await page.getByLabel("Amt").fill("40");
  await page.getByLabel("Ccy").fill("XLM");
  await pause(page, 500);
  // Add a convertible non-monetary benefit.
  await page.getByRole("button", { name: /Add item/i }).click();
  await pause(page, 400);
  await page.getByLabel("Type").last().selectOption("BENEFIT_NON_MONETARY");
  await page.getByLabel("Label").last().fill("Wellness allowance");
  await page.getByLabel("Notional").last().fill("200");
  await page.getByLabel("Conv").last().check();
  await pause(page, 800);
  mark("onboard form filled");
  await page.getByRole("button", { name: "Onboard employee" }).click();

  // --- Employee detail: package, then advance + conversion panels ---
  await page.getByRole("heading", { name: EMP_NAME }).waitFor({ timeout: 15000 });
  await pause(page, 1400); // show the compensation package card
  const advance = page.locator("section", { has: page.getByRole("heading", { name: "Salary advance" }) });
  const conversion = page.locator("section", { has: page.getByRole("heading", { name: "Convert benefits to cash" }) });

  await advance.scrollIntoViewIfNeeded();
  await pause(page, 1600); // eligibility tiles (accrued / eligible / outstanding / fee)
  mark("on employee detail");

  // --- Salary advance: request → approve & pay ---
  await advance.getByPlaceholder("amount").fill("3");
  await pause(page, 500);
  await advance.getByRole("button", { name: "Request advance" }).click();
  await advance.getByRole("button", { name: /Approve & pay/i }).waitFor({ timeout: 20000 });
  await pause(page, 1200);
  mark("advance requested");

  await advance.getByRole("button", { name: /Approve & pay/i }).click();
  await advance.getByText("disbursed", { exact: true }).waitFor({ timeout: POOL_WAIT });
  await pause(page, 1600); // disbursed via the pool rail (real on-chain leg)
  mark("advance approved & paid");

  // --- Run salary payout: nets the outstanding advance FIFO and marks it repaid ---
  await advance.getByRole("button", { name: /Run salary payout/i }).click();
  await advance.getByText(/Salary paid:/i).waitFor({ timeout: POOL_WAIT });
  await pause(page, 1200);
  await advance.getByText("repaid", { exact: true }).waitFor({ timeout: 10000 });
  await pause(page, 1800); // advance now shows "repaid"
  mark("salary payout run, advance repaid");

  // --- Non-monetary → cash conversion: convert & withdraw → approve & pay ---
  await conversion.scrollIntoViewIfNeeded();
  await pause(page, 1400); // "Wellness allowance … remaining · est. cash"
  await conversion.getByPlaceholder("amount").fill("50");
  await pause(page, 500);
  await conversion.getByRole("button", { name: /Convert & withdraw/i }).click();
  await conversion.getByRole("button", { name: /Approve & pay/i }).waitFor({ timeout: 20000 });
  await pause(page, 1200);
  mark("conversion requested");

  await conversion.getByRole("button", { name: /Approve & pay/i }).click();
  await conversion.getByText("disbursed", { exact: true }).waitFor({ timeout: POOL_WAIT });
  await pause(page, 2400); // conversion DISBURSED — cash paid via the pool rail
  mark("conversion approved & paid");
} finally {
  await page.close();
  await context.close();
  await browser.close();
}

const webm = fs.readdirSync(rawDir).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error("no video was recorded");

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
execFileSync(ffmpegPath, [
  "-y",
  "-i", path.join(rawDir, webm),
  "-vf", "fps=30,format=yuv420p",
  "-c:v", "libx264",
  "-crf", "20",
  "-preset", "medium",
  "-movflags", "+faststart",
  OUT_FILE,
]);
fs.rmSync(rawDir, { recursive: true, force: true });
console.log("HR-payroll demo written to", OUT_FILE);
