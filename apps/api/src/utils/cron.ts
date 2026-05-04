import cronParser from "cron-parser";

export interface CronCheck {
  valid: boolean;
  error?: string;
  nextRuns?: string[];
}

export function validateCron(expr: string, opts?: { tz?: string; samples?: number }): CronCheck {
  const tz = opts?.tz;
  const samples = opts?.samples ?? 5;
  try {
    const it = cronParser.parseExpression(expr, tz ? { tz } : {});
    const nextRuns: string[] = [];
    for (let i = 0; i < samples; i++) {
      nextRuns.push(it.next().toISOString());
    }
    return { valid: true, nextRuns };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}
