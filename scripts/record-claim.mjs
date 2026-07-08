// Records a demo: a freelancer (receiver) logs into the separate claim interface,
// claims a note to their crypto wallet (real testnet ZK withdraw), and then the
// settlement transaction is shown on stellar.expert. Requires docs/demo/
// .batch-notes.json + .claim-recipient.txt from the batch-send prep.
//
// Usage: node scripts/record-claim.mjs [out.mp4]
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL || "http://localhost:3000";
const OUT_FILE = path.resolve(process.argv[2] || "docs/demo/trexure-claim.mp4");
const EMAIL = "alice@claim.test";
const PASSWORD = "trexure-demo-2026";

const note = JSON.parse(fs.readFileSync("docs/demo/.batch-notes.json", "utf8")).notes[0];
const recipient = fs.readFileSync("docs/demo/.claim-recipient.txt", "utf8").trim();

const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), "trexure-claim-"));
const pause = (page, ms) => page.waitForTimeout(ms);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1366, height: 800 },
  recordVideo: { dir: rawDir, size: { width: 1366, height: 800 } },
});
const page = await context.newPage();

try {
  // --- The receiver opens the separate claim interface ---
  await page.goto(`${BASE}/claim`); // redirects to /claim/login (own persona)
  await page.getByRole("heading", { name: "Receiver access" }).waitFor({ timeout: 10000 });
  await pause(page, 2000);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await pause(page, 800);
  await page.locator('button[type="submit"]').click();

  // --- Claim form ---
  await page.getByRole("heading", { name: "Claim a payment" }).waitFor({ timeout: 10000 });
  await pause(page, 2000);
  await page.locator("textarea").fill(note); // paste the note received from the payer
  await pause(page, 1200);
  await page.getByPlaceholder("G…").fill(recipient); // pay to my Stellar wallet
  await pause(page, 1400);

  // --- Claim (real ZK withdraw on testnet; can take ~20-60s) ---
  await page.getByRole("button", { name: "Claim my payment" }).click();
  const txLink = page.getByRole("link", { name: /View withdraw transaction/i });
  await txLink.waitFor({ timeout: 150000 });
  await pause(page, 3500);

  const href = await txLink.getAttribute("href");
  console.log("withdraw tx:", href);

  // --- Show the settlement transaction on stellar.expert ---
  if (href) {
    await page.goto(href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await pause(page, 9000); // let the explorer render the tx
    await page.mouse.wheel(0, 500);
    await pause(page, 4000);
  }
} finally {
  await page.close();
  await context.close();
  await browser.close();
}

const webm = fs.readdirSync(rawDir).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error("no video recorded");
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
execFileSync(ffmpegPath, ["-y", "-i", path.join(rawDir, webm), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", OUT_FILE]);
fs.rmSync(rawDir, { recursive: true, force: true });
console.log("Claim video ->", OUT_FILE);
