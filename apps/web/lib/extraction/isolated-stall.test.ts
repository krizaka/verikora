import { describe, expect, it } from "vitest";

import { textPdf } from "../test-pdf";
import { extractPdfText } from "./isolated";

const HEAVY = textPdf(
  Array.from(
    { length: 4000 },
    (_, i) => `Ligne ${i} du bail, avec assez de texte pour que la lecture prenne du temps.`,
  ),
);

/** A runner that deschedules the web process for a moment right after the read started. */
const stall = (ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* starved on purpose */
  }
};

// verikora#603: the read runs in a worker, so the web process keeps turning while a PDF is read, even when a loaded runner
// starves the main thread for a moment after the job started. The first version of this guard asserted an ORDER of two
// callbacks (a setImmediate against the read's resolution), which flips as soon as the main thread is starved; this one
// counts the loop's turns, which only a read that blocked the process could keep low. (Proof, 6 runs: the order assertion
// failed 6/6 under this stall, the count passed 6/6.)
describe("the PDF read under a starved main thread", () => {
  it("lets the event loop turn many times while a long read is in the worker", async () => {
    await extractPdfText(textPdf(["warm"]));
    let turns = 0;
    let reading = true;
    const spin = () => {
      turns++;
      if (reading) {
        setImmediate(spin);
      }
    };
    setImmediate(spin);
    // the test body resumes in the timers phase, as after vitest's own timeout bookkeeping or a runner's sleep
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const read = extractPdfText(HEAVY, { timeoutMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    } // the job reaches the worker
    stall(30);
    await read;
    reading = false;
    expect(turns).toBeGreaterThan(5);
  });
});
