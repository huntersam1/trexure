// Verifiable Disclosure Link recorder (#128) — the "private to the world,
// provable to your auditor" moment: an ADMIN mints a share link for one settled
// payment, then (cookies cleared → logged out) an outside auditor opens
// /verify/<token>, sees only that payment, and verifies the proof on-chain.
//
// Needs `pnpm dev` running + a seeded DB. PAYMENT_ID must be a SETTLED payment
// the admin owns (pick one from the seed).
//
// Usage: SEED_ADMIN_PASSWORD=... PAYMENT_ID=... node scripts/record-audit-link.mjs [out.mp4]
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL || "http://localhost:3000";
const USERNAME = process.env.SEED_ADMIN_USERNAME || "admin";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const PAYMENT_ID = process.env.PAYMENT_ID;
const OUT_FILE = path.resolve(process.argv[2] || "docs/demo/trexure-audit-link.mp4");
if (!PASSWORD) throw new Error("SEED_ADMIN_PASSWORD env var required");
if (!PAYMENT_ID) throw new Error("PAYMENT_ID env var required (a SETTLED payment id)");

const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), "trexure-audit-"));
const pause = (page, ms) => page.waitForTimeout(ms);

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

// Red click-ripple so viewers can follow the cursor.
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
  // --- Login as the paying company's admin ---
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Username").waitFor();
  await pause(page, 700);
  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);
  await pause(page, 400);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Treasury Overview" }).waitFor({ timeout: 15000 });
  await pause(page, 900);
  mark("logged in");

  // --- Open a settled payment and mint a verifiable disclosure link ---
  await page.goto(`${BASE}/payments/${PAYMENT_ID}`);
  await page.getByRole("button", { name: /Share verifiable link/i }).waitFor({ timeout: 15000 });
  await pause(page, 1600);
  await page.getByRole("button", { name: /Share verifiable link/i }).scrollIntoViewIfNeeded();
  await pause(page, 600);
  await page.getByRole("button", { name: /Share verifiable link/i }).click();

  const urlInput = page.locator("input[readonly]").first();
  await urlInput.waitFor({ timeout: 15000 });
  await pause(page, 1800); // hold on the revealed link
  const verifyUrl = await urlInput.inputValue();
  mark(`minted link: ${verifyUrl.replace(/verify\/.*/, "verify/<token>")}`);

  // --- Become the auditor: no account. Clear the session and open the link. ---
  await context.clearCookies();
  await page.goto(verifyUrl);
  await page.getByRole("heading", { name: "Proof of payment" }).waitFor({ timeout: 15000 });
  await pause(page, 2200); // read the disclosed payment + "issuer signature valid"
  await smoothScroll(page, 360);
  await pause(page, 1600); // on-chain proof section

  // --- Verify the proof live on Stellar testnet ---
  await page.getByRole("button", { name: /Verify on-chain/i }).click();
  await page.getByText(/Verified on Stellar testnet/i).waitFor({ timeout: 45000 });
  await pause(page, 2600); // hold on the green ✓
  mark("verified on-chain");
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
console.log("Audit-link demo written to", OUT_FILE);
