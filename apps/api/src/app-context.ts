import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "./config.js";
import type { Db } from "./db/index.js";
import type { AuthService } from "./services/auth.js";
import type { ProviderService } from "./services/providers.js";
import type { HostnameService } from "./services/hostnames.js";
import type { TokenService } from "./services/tokens.js";
import type { LogService } from "./services/logs.js";
import type { SettingsService } from "./services/settings.js";
import type { IpHistoryService } from "./services/ipHistory.js";
import type { PublicIpService } from "./services/publicIp.js";
import type { UpdateProcessor } from "./services/updateProcessor.js";
import type { Scheduler } from "./services/scheduler.js";

export interface AppContext {
  config: AppConfig;
  logger: FastifyBaseLogger;
  db: Db;
  startedAt: Date;
  services: {
    auth: AuthService;
    providers: ProviderService;
    hostnames: HostnameService;
    tokens: TokenService;
    logs: LogService;
    settings: SettingsService;
    ipHistory: IpHistoryService;
    publicIp: PublicIpService;
    updateProcessor: UpdateProcessor;
    scheduler: Scheduler;
  };
}

declare module "fastify" {
  interface FastifyInstance {
    appCtx: AppContext;
  }
}
