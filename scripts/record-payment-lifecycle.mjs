// Payment-lifecycle recorder — browse one payment, scroll, apply view key, show
// the decrypted details, highlight auto-reconciliation, trigger payout, show the
// receipt. Offline (mock anchor); needs `pnpm dev` + `pnpm worker:dev` running.
//
// Usage: SEED_ADMIN_PASSWORD=... [DEMO_PAYMENT_ID=<id>] node scripts/record-payment-lifecycle.mjs [out.mp4]
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL || "http://localhost:3000";
const USERNAME = process.env.SEED_ADMIN_USERNAME || "admin";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const PAYMENT_ID = process.env.DEMO_PAYMENT_ID; // optional: jump straight to it
const OUT_FILE = path.resolve(process.argv[2] || "docs/demo/trexure-payment-lifecycle.mp4");
if (!PASSWORD) throw new Error("SEED_ADMIN_PASSWORD env var required");

const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), "trexure-lifecycle-"));
const pause = (page, ms) => page.waitForTimeout(ms);

// Smooth, human-paced page scroll (px total, over `steps` frames).
async function smoothScroll(page, px, steps = 24, delay = 45) {
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

// Red-ring click highlight (survives navigation).
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
  await pause(page, 1200);
  mark("logged in");

  // --- Open a payment (browse the list, pick the pending sample) ---
  if (PAYMENT_ID) {
    await page.goto(`${BASE}/payments/${PAYMENT_ID}`);
  } else {
    await page.goto(`${BASE}/payments`);
    await page.locator('tbody a[href^="/payments/c"]').first().waitFor({ timeout: 10000 });
    await pause(page, 1200);
    await page.locator('tbody a[href^="/payments/c"]').first().click();
  }
  await page.getByRole("heading", { name: "Payment Lifecycle" }).waitFor({ timeout: 10000 });
  await pause(page, 1500);
  mark("payment open");

  // --- Browse the payment info: scroll through the shielded public ledger ---
  await page.getByText("Internal Enclave").scrollIntoViewIfNeeded();
  await pause(page, 1800);
  await smoothScroll(page, -300); // scroll back up to show the top (stepper + shielded rows)
  await pause(page, 1500);
  mark("browsed payment");

  // --- Apply View Key → reveal the decrypted details ---
  await page.getByRole("button", { name: "Apply View Key" }).scrollIntoViewIfNeeded();
  await pause(page, 700);
  await page.getByRole("button", { name: "Apply View Key" }).click();
  await page.getByText("Decrypted in enclave").waitFor({ timeout: 10000 });
  await pause(page, 2600); // let the reveal animation + details settle
  mark("view key applied");

  // --- Highlight Auto-Reconciliation, then Trigger Payout ---
  await page.getByRole("heading", { name: "Auto-Reconciliation" }).scrollIntoViewIfNeeded();
  await pause(page, 1800);
  await page.getByRole("button", { name: "Trigger Payout" }).click();
  mark("payout triggered");
  // Watch the on-chain ↔ fiat legs reconcile, then settle.
  await page.getByRole("button", { name: "Settled" }).waitFor({ timeout: 45000 });
  await pause(page, 1800);
  mark("settled");

  // --- Show the receipt ---
  await page.getByText("Payment Confirmed").scrollIntoViewIfNeeded();
  await pause(page, 1200);
  await smoothScroll(page, 260); // scroll through the receipt body
  await pause(page, 3000);
  mark("receipt");
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
console.log("Payment lifecycle demo written to", OUT_FILE);
