// Reports showcase recorder — tour the ADMIN /reports area: the reconciliation
// statement, then each report type (compliance disclosure, payroll register, FX
// gain/loss), scrolling through each. Needs `pnpm dev` running + a seeded DB.
//
// Usage: SEED_ADMIN_PASSWORD=... node scripts/record-reports.mjs [out.mp4]
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL || "http://localhost:3000";
const USERNAME = process.env.SEED_ADMIN_USERNAME || "admin";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const OUT_FILE = path.resolve(process.argv[2] || "docs/demo/trexure-reports.mp4");
if (!PASSWORD) throw new Error("SEED_ADMIN_PASSWORD env var required");

// Wide range so every report has data (the demo seed spans ~May–Jul 2026).
const RANGE = "from=2026-05-01&to=2026-07-31";

const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), "trexure-reports-"));
const pause = (page, ms) => page.waitForTimeout(ms);

async function smoothScroll(page, px, steps = 26, delay = 45) {
  const per = px / steps;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, per);
    await page.waitForTimeout(delay);
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: rawDir, size: { width: 1920, height: 1080 } },
});

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
const t0 = Date.now();
const mark = (label) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);

// View a report page: wait for its heading, pause, scroll down through it, hold.
async function tour(url, heading, { scroll = 700 } = {}) {
  await page.goto(`${BASE}${url}`);
  await page.getByRole("heading", { name: heading }).first().waitFor({ timeout: 15000 });
  await pause(page, 1800);
  await smoothScroll(page, scroll);
  await pause(page, 2200);
}

try {
  // --- Login ---
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Username").waitFor();
  await pause(page, 700);
  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);
  await pause(page, 400);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Treasury Overview" }).waitFor({ timeout: 15000 });
  await pause(page, 1000);
  mark("logged in");

  // --- Reports hub: the report cards + the reconciliation statement ---
  await page.goto(`${BASE}/reports?${RANGE}`);
  await page.getByRole("heading", { name: "Reports" }).waitFor({ timeout: 15000 });
  await pause(page, 1800);
  await smoothScroll(page, 340); // reveal the four report-type cards
  await pause(page, 2200);
  await page.getByRole("heading", { name: "Reconciliation Statement" }).scrollIntoViewIfNeeded();
  await pause(page, 1500);
  await smoothScroll(page, 520); // settled payments + exceptions tables + totals
  await pause(page, 2200);
  mark("reconciliation");

  // --- Compliance & Audit Disclosure Pack ---
  await tour(`/reports/disclosure?${RANGE}`, "Compliance & Audit Disclosure Pack", { scroll: 620 });
  mark("disclosure");

  // --- Disbursement / Payroll Register ---
  await tour(`/reports/payroll?${RANGE}`, "Disbursement / Payroll Register", { scroll: 620 });
  mark("payroll");

  // --- FX Realized Gain/Loss & Fees ---
  await tour(`/reports/fx?${RANGE}`, "FX Realized Gain/Loss & Fees", { scroll: 640 });
  await pause(page, 1200);
  mark("fx");
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
console.log("Reports demo written to", OUT_FILE);
