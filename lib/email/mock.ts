import "server-only";

import { randomBytes } from "node:crypto";

import { logger } from "@/lib/log";
import type { EmailProvider } from "./provider";

/**
 * Mock email provider (#81). Doesn't hit the network — logs the message (subject
 * + recipient only, never the body, so a claim link never lands in logs) and
 * returns a synthetic id. Keeps CI/offline demos green while still exercising the
 * full send path + per-receiver status tracking.
 */
export const mockEmailProvider: EmailProvider = {
  name: "mock",
  async send(msg) {
    const id = `mock_email_${randomBytes(8).toString("hex")}`;
    logger.info({ to: msg.to, subject: msg.subject, id }, "mock email sent");
    return { id };
  },
};
