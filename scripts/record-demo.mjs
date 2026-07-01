// Records a short screen-capture demo of the payment lifecycle against a
// running local dev stack, then converts it to mp4. Requires:
//   - `pnpm dev` + `pnpm worker:dev` + `docker compose up -d` already running
//   - `npx playwright install chromium` (one-time browser download)
//   - the seeded sample payment in a clean PENDING state (`pnpm db:seed`)
//
// Usage: SEED_ADMIN_PASSWORD=... pnpm demo:record [output.mp4]
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL || "http://localhost:3000";
const USERNAME = process.env.SEED_ADMIN_USERNAME || "admin";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const OUT_FILE = path.resolve(process.argv[2] || "docs/demo/trexure-demo.mp4");
if (!PASSWORD) throw new Error("SEED_ADMIN_PASSWORD env var required");

const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), "trexure-demo-"));
const pause = (page, ms) => page.waitForTimeout(ms);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: rawDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();

try {
  // --- Login ---
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Username").waitFor();
  await pause(page, 1500);
  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);
  await pause(page, 600);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Treasury Overview" }).waitFor({ timeout: 15000 });
  await pause(page, 2500);

  // --- Navigate into the sample payment ---
  await page.locator("table tbody tr a").first().click();
  await page.getByRole("heading", { name: "Payment Lifecycle" }).waitFor({ timeout: 10000 });
  await pause(page, 2500);

  // --- Beat 1: Shield (public ledger view) ---
  await page.getByText("Internal Enclave").scrollIntoViewIfNeeded();
  await pause(page, 2500);

  // --- Beat 2: Apply View Key ---
  await page.getByRole("button", { name: "Apply View Key" }).click();
  await page.getByText("Decrypted in enclave").waitFor({ timeout: 10000 });
  await pause(page, 3000);

  // --- Beat 3: Trigger Payout / reconciliation ---
  await page.getByRole("button", { name: "Trigger Payout" }).scrollIntoViewIfNeeded();
  await pause(page, 800);
  await page.getByRole("button", { name: "Trigger Payout" }).click();
  await page.getByRole("button", { name: "Settled" }).waitFor({ timeout: 30000 });
  await pause(page, 2000);

  // --- Beat 4: Receipt ---
  await page.getByText("Payment Confirmed").scrollIntoViewIfNeeded();
  await pause(page, 3000);
  await page.getByRole("button", { name: "Show raw JSON" }).click();
  await pause(page, 2500);

  // --- Bonus: Verify proof on-chain (real Groth16 verify vs. Soroban testnet) ---
  await page.getByRole("button", { name: "Verify proof on-chain" }).scrollIntoViewIfNeeded();
  await pause(page, 800);
  await page.getByRole("button", { name: "Verify proof on-chain" }).click();
  await page
    .getByText(/Proof verified on Stellar testnet|Proof did NOT verify/)
    .waitFor({ timeout: 60000 });
  await pause(page, 4500);
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
console.log("Demo video written to", OUT_FILE);
