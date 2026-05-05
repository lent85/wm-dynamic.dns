import fs from "node:fs";
import path from "node:path";
import type { RuntimeConfigFile, RuntimeConfigUpdateRequest } from "@wm-ddns/shared";
import { runtimeConfigFileSchema } from "@wm-ddns/shared";
import { readRuntimeConfigFile } from "../config.js";

function mergePatch(current: RuntimeConfigFile, patch: RuntimeConfigUpdateRequest): RuntimeConfigFile {
  const next: RuntimeConfigFile = { ...current };
  for (const key of Object.keys(patch) as (keyof RuntimeConfigUpdateRequest)[]) {
    const v = patch[key];
    if (v !== undefined) next[key] = v as never;
  }
  return runtimeConfigFileSchema.parse(next);
}

export function writeRuntimeConfigPatch(
  filePath: string,
  patch: RuntimeConfigUpdateRequest,
): RuntimeConfigFile {
  const current = readRuntimeConfigFile(filePath);
  const merged = mergePatch(current, patch);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.runtime-config.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, filePath);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
  return merged;
}
