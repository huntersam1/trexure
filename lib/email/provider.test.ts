import { describe, it, expect } from "vitest";
import { getEmailProvider } from "@/lib/email/provider";
import { mockEmailProvider } from "@/lib/email/mock";

describe("email provider (#81)", () => {
  it("selects the mock provider by default (EMAIL_PROVIDER defaults to mock)", () => {
    expect(getEmailProvider().name).toBe("mock");
  });

  it("mock send returns a synthetic id without hitting the network", async () => {
    const res = await mockEmailProvider.send({
      to: "someone@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(res.id).toMatch(/^mock_email_/);
  });
});
