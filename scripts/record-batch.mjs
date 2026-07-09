// Records a demo: a payer creates a private batch payment to 2 receivers and
// receives one claimable note per receiver. Real testnet deposits. Writes the
// notes to docs/demo/.batch-notes.json so the claim demo can reuse note[0].
//
// Usage: SEED_ADMIN_PASSWORD=... node scripts/record-batch.mjs [out.mp4]
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL || "http://localhost:3000";
const USERNAME = process.env.SEED_ADMIN_USERNAME || "admin";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || (fs.readFileSync(".env", "utf8").match(/^SEED_ADMIN_PASSWORD=(.*)$/m)?.[1] ?? "");
const OUT_FILE = path.resolve(process.argv[2] || "docs/demo/trexure-batch-send.mp4");
const NOTES_FILE = path.resolve("docs/demo/.batch-notes.json");
if (!PASSWORD) throw new Error("SEED_ADMIN_PASSWORD required");

const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), "trexure-batch-"));
const pause = (page, ms) => page.waitForTimeout(ms);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: rawDir, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();

let notes = [];
try {
  // --- Login as the paying company ---
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Username").waitFor();
  await pause(page, 1200);
  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);
  await pause(page, 600);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 15000 }).catch(() => {});
  await pause(page, 2000);

  // --- Open the Batch payments area ---
  await page.getByRole("link", { name: "Batch payments" }).click();
  await page.getByRole("heading", { name: "Batch payments" }).waitFor({ timeout: 10000 });
  await pause(page, 1800);
  await page.getByRole("link", { name: "New batch" }).click();
  await page.getByRole("heading", { name: "Batch send" }).waitFor({ timeout: 10000 });
  await pause(page, 1800);

  // --- Receiver 1 ---
  await page.getByLabel("Amount for receiver 1").fill("5");
  await page.getByLabel("Label for receiver 1").fill("Alice — July invoice");
  await page.getByLabel("Email for receiver 1").fill("alice@claim.test");
  await pause(page, 1000);

  // --- Add + fill receiver 2 ---
  await page.getByRole("button", { name: "Add receiver" }).click();
  await pause(page, 600);
  await page.getByLabel("Amount for receiver 2").fill("5");
  await page.getByLabel("Label for receiver 2").fill("Bob — contractor payout");
  await page.getByLabel("Email for receiver 2").fill("bob@claim.test");
  await pause(page, 1400);

  // --- Send the batch (2 real testnet deposits, sequential) ---
  await page.getByRole("button", { name: /Send batch/ }).click();
  await page.getByRole("heading", { name: /Batch sent/ }).waitFor({ timeout: 180000 });
  await pause(page, 2500);

  // Capture the notes (bearer credentials) for the claim demo.
  notes = (await page.locator("code").filter({ hasText: "trexure-note-v1-" }).allTextContents())
    .map((s) => s.trim());

  // Slowly reveal the results (bearer warning + per-receiver notes).
  await page.getByText(/bearer credential/i).first().scrollIntoViewIfNeeded();
  await pause(page, 3500);
  await page.mouse.wheel(0, 400);
  await pause(page, 3500);

  // --- Show it in the batch overview ---
  const viewBatch = page.getByRole("link", { name: /view batch/i });
  if (await viewBatch.count()) {
    await viewBatch.first().click();
    await pause(page, 3500);
  }
} finally {
  await page.close();
  await context.close();
  await browser.close();
}

if (notes.length) {
  fs.mkdirSync(path.dirname(NOTES_FILE), { recursive: true });
  fs.writeFileSync(NOTES_FILE, JSON.stringify({ notes, createdAt: Date.now() }, null, 2));
  console.log(`captured ${notes.length} note(s) -> ${NOTES_FILE}`);
} else {
  console.warn("WARNING: no notes captured");
}

const webm = fs.readdirSync(rawDir).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error("no video recorded");
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
execFileSync(ffmpegPath, ["-y", "-i", path.join(rawDir, webm), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", OUT_FILE]);
fs.rmSync(rawDir, { recursive: true, force: true });
console.log("Batch-send video ->", OUT_FILE);
