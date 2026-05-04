import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  const { app, ctx } = await buildServer({ config, logger });

  ctx.services.scheduler.start();

  // Best-effort initial public-IP probe so the dashboard has data on load.
  if (config.selfDetectIntervalSec > 0) {
    void ctx.services.publicIp.detect().catch(() => undefined);
  }

  await app.listen({ host: config.host, port: config.port });
  logger.info(
    { host: config.host, port: config.port, env: config.nodeEnv },
    "wm-dynamic-dns started",
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    try {
      await app.close();
    } catch (err) {
      logger.error({ err }, "error during shutdown");
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", err);
  process.exit(1);
});
