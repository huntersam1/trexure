import { describe, it, expect } from "vitest";
import { verifyHmac, signHmac } from "@/lib/webhooks/verify";

const secret = "test-callback-token";

describe("signHmac / verifyHmac", () => {
  it("accepts a signature produced over the same raw bytes", () => {
    const raw = '{"id":"evt_1","amount":"100.00"}';
    const sig = signHmac(raw, secret);
    expect(verifyHmac(raw, sig, secret)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const raw = '{"id":"evt_1"}';
    const sig = signHmac(raw, secret);
    expect(verifyHmac(raw, sig.slice(0, -1) + "0", secret)).toBe(false);
  });

  it("rejects when the secret differs", () => {
    const raw = '{"id":"evt_1"}';
    expect(verifyHmac(raw, signHmac(raw, secret), "other-secret")).toBe(false);
  });

  it("rejects empty signature / empty secret", () => {
    expect(verifyHmac("{}", "", secret)).toBe(false);
    expect(verifyHmac("{}", signHmac("{}", secret), "")).toBe(false);
  });

  // The load-bearing raw-body guarantee: a re-serialized body must NOT verify.
  it("rejects a re-serialized (parsed→stringified) body", () => {
    const raw = '{ "id": "evt_1", "amount": "100.00" }'; // note the spaces / key order
    const sig = signHmac(raw, secret);
    const reSerialized = JSON.stringify(JSON.parse(raw)); // '{"id":"evt_1","amount":"100.00"}'
    expect(reSerialized).not.toBe(raw);
    expect(verifyHmac(reSerialized, sig, secret)).toBe(false);
    expect(verifyHmac(raw, sig, secret)).toBe(true);
  });
});
