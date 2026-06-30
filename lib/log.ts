import "server-only";
import pino from "pino";
import { env } from "./env";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "authorization",
      "cookie",
      "password",
      "*.token",
      "*.secret",
      "viewKey",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  base: { service: "trexure-web" },
});
