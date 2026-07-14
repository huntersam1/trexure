// Treasury Float Yield walkthrough recorder — one continuous ADMIN flow:
// Treasury Yield dashboard (idle float earning at the effective APY) → enable +
// configure yield (a real, persisted settings action) → Reports → Yield
// Attribution report (per-position accrued yield, platform fee, and net to the
// tenant, with CSV/PDF export).
//
// Needs `ENABLE_YIELD=true pnpm dev` running + `tsx scripts/seed-yield-demo.mts`
// run first (so the dashboard/report show realistic numbers).
// Usage: SEED_ADMIN_PASSWORD=... node scripts/record-yield.mjs [out.mp4]
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL || "http://localhost:3000";
const USERNAME = process.env.SEED_ADMIN_USERNAME || "admin";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const OUT_FILE = path.resolve(process.argv[2] || "docs/demo/trexure-yield.mp4");
if (!PASSWORD) throw new Error("SEED_ADMIN_PASSWORD env var required");

const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), "trexure-yield-"));
const pause = (page, ms) => page.waitForTimeout(ms);

async function smoothScroll(page, px, steps = 24, delay = 45) {
  const per = px / steps;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, per);
    await page.waitForTimeout(delay);
  }
}

const browser = await chromium.launch();

// Warm-up (not recorded): Next dev compiles a route on its first hit (15-30s).
// Pre-compile the authed pages in a throwaway context so the recorded pass is smooth.
{
  const warm = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const wp = await warm.newPage();
  wp.setDefaultTimeout(60000);
  await wp.goto(`${BASE}/login`);
  await wp.getByLabel("Username").fill(USERNAME);
  await wp.getByLabel("Password").fill(PASSWORD);
  await wp.getByRole("button", { name: "Sign in" }).click();
  await wp.getByRole("heading", { name: "Treasury Overview" }).waitFor();
  await wp.goto(`${BASE}/yield`);
  await wp.getByRole("heading", { name: "Treasury Yield" }).waitFor();
  await wp.goto(`${BASE}/reports/yield`);
  await wp.getByRole("heading", { name: "Yield Attribution" }).waitFor();
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
page.setDefaultTimeout(60000);
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

  // --- Treasury Yield dashboard: the idle float earning ---
  await page.getByRole("link", { name: "Treasury Yield" }).click();
  await page.getByRole("heading", { name: "Treasury Yield", exact: true }).waitFor({ timeout: 15000 });
  await pause(page, 2000); // KPI row: In yield (YLDS) · Accrued yield · Effective APY
  mark("on treasury yield dashboard");
  await smoothScroll(page, 260);
  await pause(page, 1800); // Active positions · Unwound · Buffer fallbacks · Net yield

  // --- Configure + enable yield (a real, persisted action) ---
  await page.getByRole("heading", { name: "Yield configuration" }).scrollIntoViewIfNeeded();
  await pause(page, 1200);
  await page.getByLabel("Min idle buffer").fill("100");
  await pause(page, 400);
  await page.getByLabel("Platform fee (bps)").fill("25");
  await pause(page, 600);
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByText(/yield (enabled|settings saved)/i).waitFor({ timeout: 15000 });
  await pause(page, 2000); // success confirmation
  mark("yield configured + saved");

  // --- Reports → Yield Attribution ---
  await page.goto(`${BASE}/reports`);
  await page.getByRole("heading", { name: "Reports" }).waitFor({ timeout: 15000 });
  await pause(page, 900);
  await page.getByText("Treasury Yield Attribution").scrollIntoViewIfNeeded();
  await pause(page, 1200);
  await page.getByText("Treasury Yield Attribution").click();
  await page.getByRole("heading", { name: "Yield Attribution" }).waitFor({ timeout: 15000 });
  await pause(page, 1800); // stat cards: Positions · In yield · Accrued · Net
  mark("on yield attribution report");

  // Walk the per-position table (principal / accrued / fee / net) + export controls.
  await smoothScroll(page, 420);
  await pause(page, 2600); // the positions table — the audit-ready per-position split
  await page.getByRole("link", { name: "CSV" }).scrollIntoViewIfNeeded();
  await pause(page, 1600); // CSV / PDF export for accounting
  mark("walked attribution table");
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
console.log("Treasury Yield demo written to", OUT_FILE);
