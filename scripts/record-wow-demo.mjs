// "Wow demo" recorder — end-to-end payment lifecycle + REAL testnet tx on
// stellar.expert, with red-ring click highlights. Target: <= 60s.
//
// Prereqs: pnpm dev + pnpm worker:dev running; DB seeded with
// SEED_ONCHAIN=true so the sample payment's on-chain leg is a real tx.
//
// Usage: SEED_ADMIN_PASSWORD=... DEMO_TX_HASH=<hash> node scripts/record-wow-demo.mjs [out.mp4]
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL || "http://localhost:3000";
const USERNAME = process.env.SEED_ADMIN_USERNAME || "admin";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const TX_HASH = process.env.DEMO_TX_HASH;
const OUT_FILE = path.resolve(process.argv[2] || "docs/demo/trexure-wow-demo.mp4");
if (!PASSWORD) throw new Error("SEED_ADMIN_PASSWORD env var required");
if (!TX_HASH) throw new Error("DEMO_TX_HASH env var required (the real on-chain leg tx hash)");

const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), "trexure-wow-"));
const pause = (page, ms) => page.waitForTimeout(ms);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: rawDir, size: { width: 1280, height: 720 } },
});

// Red-ring click highlight: an expanding, fading red circle at every mousedown.
// Registered as an init script so it survives navigations (incl. stellar.expert).
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
  // --- Beat 0: Login (~6s) ---
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Username").waitFor();
  await pause(page, 800);
  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);
  await pause(page, 400);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Treasury Overview" }).waitFor({ timeout: 15000 });
  await pause(page, 1500);
  mark("logged in");

  // --- Open the sample payment (~3s) ---
  await page.locator("table tbody tr a").first().click();
  await page.getByRole("heading", { name: "Payment Lifecycle" }).waitFor({ timeout: 10000 });
  await pause(page, 1800);
  mark("payment open");

  // --- Beat 1: the Shield — public ledger sees nothing (~3s) ---
  await page.getByText("Internal Enclave").scrollIntoViewIfNeeded();
  await pause(page, 2200);
  mark("shield beat");

  // --- Beat 2: Apply View Key — decrypt server-side (~4s) ---
  await page.getByRole("button", { name: "Apply View Key" }).click();
  await page.getByText("Decrypted in enclave").waitFor({ timeout: 10000 });
  await pause(page, 2200);
  mark("view key applied");

  // --- Beat 3: Verify proof on-chain (REAL Groth16 vs Soroban testnet) ---
  await page.getByRole("button", { name: "Verify proof on-chain" }).scrollIntoViewIfNeeded();
  await pause(page, 500);
  await page.getByRole("button", { name: "Verify proof on-chain" }).click();
  await page
    .getByText(/Proof verified on Stellar testnet|Proof did NOT verify/)
    .waitFor({ timeout: 60000 });
  await pause(page, 2200);
  mark("proof verified");

  // --- Beat 4: Trigger Payout → auto-reconcile → SETTLED (~8s) ---
  await page.getByRole("button", { name: "Trigger Payout" }).scrollIntoViewIfNeeded();
  await pause(page, 500);
  await page.getByRole("button", { name: "Trigger Payout" }).click();
  await page.getByRole("button", { name: "Settled" }).waitFor({ timeout: 30000 });
  await pause(page, 1500);
  mark("settled");

  // --- Beat 5: the Receipt (~4s) ---
  await page.getByText("Payment Confirmed").scrollIntoViewIfNeeded();
  await pause(page, 2500);
  mark("receipt");

  // --- Beat 6: THE WOW — the same tx, live on stellar.expert (~9s) ---
  await page.goto(`https://stellar.expert/explorer/testnet/tx/${TX_HASH}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  // Let the explorer hydrate, then center the tx summary in the viewport.
  await pause(page, 3500);
  const h = page.locator("h2, h1").first();
  await h.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await pause(page, 4500);
  mark("stellar.expert");
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
console.log("Wow demo written to", OUT_FILE);
