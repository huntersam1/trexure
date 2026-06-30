import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    S3_ENDPOINT: "http://localhost:9000",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: "minioadmin",
    S3_SECRET_ACCESS_KEY: "minioadmin",
    S3_BUCKET: "trexure-receipts",
    S3_FORCE_PATH_STYLE: true,
  },
}));

import { getSignedDownloadUrl, putObject, getObject } from "@/lib/storage";

describe("storage signed url construction (unit, offline)", () => {
  it("builds a presigned URL containing bucket, key, and signature params", async () => {
    const url = await getSignedDownloadUrl("receipts/rcpt_123.pdf", 900);
    expect(url).toContain("trexure-receipts"); // forcePathStyle => bucket in path
    expect(url).toContain("receipts/rcpt_123.pdf");
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=900");
  });

  it("defaults the TTL to 900 seconds when omitted", async () => {
    const url = await getSignedDownloadUrl("receipts/rcpt_456.pdf");
    expect(url).toContain("X-Amz-Expires=900");
  });
});

// Guarded MinIO integration: only runs when RUN_S3_INTEGRATION=1 and docker compose is up.
const integration = process.env.RUN_S3_INTEGRATION === "1" ? describe : describe.skip;
integration("storage round-trip against MinIO", () => {
  it("puts then gets the same bytes", async () => {
    const { ensureBucket } = await import("@/lib/storage");
    await ensureBucket();
    const key = `test/${Date.now()}.bin`;
    const body = Buffer.from("hello-minio");
    await putObject(key, body, "application/octet-stream");
    const got = await getObject(key);
    expect(got.equals(body)).toBe(true);
  });
});
