/**
 * At server start: refuse to run without the production secrets, then apply the database migrations (one advisory lock,
 * so a second instance waits instead of racing).
 */
export async function registerNode() {
  try {
    await start();
  } catch (error) {
    // The platform prints what is thrown: only a described, redacted error leaves here, never the original, which can hold a connection string (verikora#386).
    const { logError } = await import("./lib/log");
    const { sanitizedError } = await import("./lib/redact");
    logError("[verikora] start-up failed:", error);
    throw sanitizedError(error);
  }
}

async function start() {
  const { logInfo, logWarn, logError } = await import("./lib/log");
  const { assertProductionEnv, readEnv } = await import("./lib/env");
  assertProductionEnv();
  if (!readEnv().DATABASE_URL) {
    logWarn("[verikora] DATABASE_URL is not set: the public pages work, the library does not.");
    return;
  }
  const { migrate } = await import("./lib/db");
  const applied = await migrate();
  if (applied.length) {
    logInfo(`[verikora] migrations applied: ${applied.join(", ")}`);
  }
  // A database that lacks a version of a Krizaka module the code needs does not start (krizaka-ts ADR-001).
  const { assertModules } = await import("@krizaka/db");
  const { MODULES } = await import("./lib/modules");
  const { query } = await import("./lib/db");
  await assertModules(query, MODULES);
  // The environment only bootstraps the storage: its old coordinates become the admin's first provider, once (ADR-005, verikora#523).
  const { bootstrapFromEnvironment } = await import("./app/storage-providers");
  const imported = await bootstrapFromEnvironment();
  if (imported) {
    logInfo(`[verikora] storage provider imported from the environment: ${imported}`);
  }
  const { seedDatabase } = await import("./lib/flows");
  // Live screening is refused at start unless the compliance gate is open (verikora#135).
  const { assertLiveGate } = await import("./lib/screening-checks/gate");
  await assertLiveGate();
  const seeded = await seedDatabase();
  if (seeded.length) {
    logInfo(`[verikora] flows seeded: ${seeded.join(", ")}`);
  }
  // The organised workspace's defaults (the decision set, the system views, the tag rules): written once, then the database is the source of truth (verikora#324).
  const { seedWorkspace } = await import("./lib/workspace/service");
  const { systemClock } = await import("./app/system-clock");
  const workspace = await seedWorkspace(systemClock);
  if (workspace.length) {
    logInfo(`[verikora] workspace seeded: ${workspace.join(", ")}`);
  }
  const e = readEnv();
  const { appSettings } = await import("./lib/settings/instance");
  const { seedLegacySettings } = await import("./lib/settings/seed");
  const legacy = await seedLegacySettings(
    appSettings(),
    { signupOpen: e.AUTH_SIGNUP_ENABLED, purgeAfterHours: e.APP_PURGE_AFTER_HOURS },
    new Date(),
  );
  if (legacy.length) {
    logInfo(`[verikora] settings seeded from the environment: ${legacy.join(", ")}`);
  }
  // A batch advances without anyone looking at it (verikora#240): the interval is a setting, re-read at every look.
  const { sessionSecret } = await import("./lib/env");
  const { registerBatchWebhooks, deliverWebhooks } = await import("./lib/webhooks/emit");
  registerBatchWebhooks(sessionSecret());
  const { startScheduler } = await import("./lib/batch/scheduler");
  const { tickBatches } = await import("./lib/batch/tick");
  const { appEnvironment } = await import("./lib/env");
  startScheduler({
    seconds: async () => (await appSettings().get("limits.batchTickSeconds")) as number,
    run: async () => {
      const report = await tickBatches(new Date(), appEnvironment(), (message, error) =>
        logError(`[verikora] ${message}`, error),
      );
      if (report.advanced || report.failed) {
        logInfo(`[verikora] batch tick: ${report.advanced} advanced, ${report.failed} failed`);
      }
      // The uses a checkout reserved and nobody paid for are given back once their deadline passed (coupons, verikora#262).
      const { sweepCoupons } = await import("./lib/coupons/sweep");
      const freed = await sweepCoupons();
      if (freed) {
        logInfo(`[verikora] coupons: ${freed} unpaid reservation(s) released`);
      }
      // The retention sweep (verikora#125): documents past their window, screening results past their policy's days.
      const { purgeExpired: purgeDocuments } = await import("./lib/retention");
      const { purgeExpired: purgeResults } = await import("./lib/screening");
      const { query: sweepQuery } = await import("./lib/db");
      const { holderOf: documentHolder } = await import("./app/active-store");
      const purgedDocuments = await purgeDocuments(sweepQuery, new Date(), documentHolder);
      // The bytes still in the database move to the store, a few at a time (ADR-0012): copied, read back, SHA-256 checked, then the column emptied.
      const { backfillDocuments } = await import("./lib/documents-backfill");
      const { readEnv: backfillEnv } = await import("./lib/env");
      const mode = backfillEnv().APP_DOCUMENTS_BACKFILL;
      if (mode !== "off") {
        const moved = await backfillDocuments(sweepQuery, documentHolder, { dryRun: mode === "dry-run", limit: 25 });
        if (moved.candidates) {
          logInfo(
            `[verikora] documents backfill${moved.dryRun ? " (dry run)" : ""}: ${moved.candidates} to move, ${moved.copied} moved, ${moved.failed.length} left`,
          );
        }
      }
      const purgedResults = await purgeResults(new Date());
      if (purgedDocuments || purgedResults) {
        logInfo(`[verikora] retention: ${purgedDocuments} documents, ${purgedResults} results purged`);
      }
      // The verified move of the documents to a new storage provider advances one batch per look, while an administrator has one open (ADR-005 §3).
      const { moveDeps } = await import("./app/storage-providers");
      const { stepMove } = await import("./lib/storage/provider-move");
      const moving = moveDeps();
      const step = moving ? await stepMove(moving) : null;
      if (step) {
        logInfo(
          `[verikora] storage move: ${step.moved}/${step.total} moved, ${step.failed.length} failed (${step.status})`,
        );
      }
      // The screening checks a provider accepted without answering are collected on the same look (verikora#134).
      const { collectPending } = await import("./lib/screening-checks/collect");
      const collected = await collectPending(new Date());
      if (collected.polled) {
        logInfo(`[verikora] screening checks: ${collected.polled} polled, ${collected.settled} settled`);
      }
      // The webhooks queued by closed batches ride the same tick (verikora#241).
      const sent = await deliverWebhooks(sessionSecret(), new Date(), { timeoutMs: 8000 });
      if (sent && (sent.delivered || sent.retried || sent.failed)) {
        logInfo(`[verikora] webhooks: ${sent.delivered} delivered, ${sent.retried} to retry, ${sent.failed} given up`);
      }
    },
    onError: (error) => logError("[verikora] batch tick", error),
  });
}
