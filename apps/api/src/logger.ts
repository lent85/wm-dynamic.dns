import pino from "pino";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "./config.js";

export function createLogger(config: AppConfig): FastifyBaseLogger {
  const isDev = config.nodeEnv === "development";
  const transport = isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "yyyy-mm-dd HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      }
    : undefined;
  return pino({
    level: config.logLevel,
    base: undefined,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.password",
        "*.token",
        "*.apiToken",
        "*.plainToken",
        "config.token",
        "config.apiToken",
      ],
      censor: "[REDACTED]",
    },
    transport,
  }) as unknown as FastifyBaseLogger;
}
