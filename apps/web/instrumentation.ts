/**
 * At server start: refuse to run without the production secrets, then apply the database migrations (one advisory lock,
 * so a second instance waits instead of racing).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    await start();
  } catch (error) {
    // The platform prints what is thrown: only a described, redacted error leaves here, never the original, which can hold a connection string (yomizaka#386).
    const { logError } = await import("./lib/log");
    const { sanitizedError } = await import("./lib/redact");
    logError("[yomizaka] start-up failed:", error);
    throw sanitizedError(error);
  }
}

async function start() {
  const { logInfo, logWarn, logError } = await import("./lib/log");
  const { assertProductionEnv, readEnv } = await import("./lib/env");
  assertProductionEnv();
  if (!readEnv().DATABASE_URL) {
    logWarn("[yomizaka] DATABASE_URL is not set: the public pages work, the library does not.");
    return;
  }
  const { migrate } = await import("./lib/db");
  const applied = await migrate();
  if (applied.length) logInfo(`[yomizaka] migrations applied: ${applied.join(", ")}`);
  // A database that lacks a version of a Krizaka module the code needs does not start (krizaka-ts ADR-001).
  const { assertModules } = await import("@krizaka/db");
  const { MODULES } = await import("./lib/modules");
  const { query } = await import("./lib/db");
  await assertModules(query, MODULES);
  const { seedDatabase } = await import("./lib/flows");
  const seeded = await seedDatabase();
  if (seeded.length) logInfo(`[yomizaka] flows seeded: ${seeded.join(", ")}`);
  // The organised workspace's defaults (the decision set, the system views, the tag rules): written once, then the database is the source of truth (yomizaka#324).
  const { seedWorkspace } = await import("./lib/workspace/service");
  const { systemClock } = await import("./app/system-clock");
  const workspace = await seedWorkspace(systemClock);
  if (workspace.length) logInfo(`[yomizaka] workspace seeded: ${workspace.join(", ")}`);
  const e = readEnv();
  const { appSettings } = await import("./lib/settings/instance");
  const { seedLegacySettings } = await import("./lib/settings/seed");
  const legacy = await seedLegacySettings(appSettings(), { signupOpen: e.AUTH_SIGNUP_ENABLED, purgeAfterHours: e.APP_PURGE_AFTER_HOURS }, new Date());
  if (legacy.length) logInfo(`[yomizaka] settings seeded from the environment: ${legacy.join(", ")}`);
  // A batch advances without anyone looking at it (yomizaka#240): the interval is a setting, re-read at every look.
  const { sessionSecret } = await import("./lib/env");
  const { registerBatchWebhooks, deliverWebhooks } = await import("./lib/webhooks/emit");
  registerBatchWebhooks(sessionSecret());
  const { startScheduler } = await import("./lib/batch/scheduler");
  const { tickBatches } = await import("./lib/batch/tick");
  const { appEnvironment } = await import("./lib/env");
  startScheduler({
    seconds: async () => (await appSettings().get("limits.batchTickSeconds")) as number,
    run: async () => {
      const report = await tickBatches(new Date(), appEnvironment(), (message, error) => logError(`[yomizaka] ${message}`, error));
      if (report.advanced || report.failed) logInfo(`[yomizaka] batch tick: ${report.advanced} advanced, ${report.failed} failed`);
      // The screening checks a provider accepted without answering are collected on the same look (yomizaka#134).
      const { collectPending } = await import("./lib/screening-checks/collect");
      const collected = await collectPending(new Date());
      if (collected.polled) logInfo(`[yomizaka] screening checks: ${collected.polled} polled, ${collected.settled} settled`);
      // The webhooks queued by closed batches ride the same tick (yomizaka#241).
      const sent = await deliverWebhooks(sessionSecret(), new Date(), { timeoutMs: 8000 });
      if (sent && (sent.delivered || sent.retried || sent.failed)) logInfo(`[yomizaka] webhooks: ${sent.delivered} delivered, ${sent.retried} to retry, ${sent.failed} given up`);
    },
    onError: (error) => logError("[yomizaka] batch tick", error),
  });
}
