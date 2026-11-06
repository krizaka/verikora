// A recorded take: one page captured with the Chrome DevTools screencast (every frame the compositor paints, with its
// timestamp), encoded at a constant 30 fps, with the beats of the walkthrough, EN and FR captions (WebVTT, kept apart from
// the picture) and, on request, a voice-over (macOS `say`) mixed into a separate « narrated » file.
// Waiting for a real run (Sovkora answering) can be sped up with `take.fast(start, end, speed)`; the speed-up is the only
// edit, and it is said in the metadata.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, "0");
/** `00:01:02.500` */
export function vttTime(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${pad(ms / 3_600_000)}:${pad((ms / 60_000) % 60)}:${pad((ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/** WebVTT cues from beats (`{id, at}` in output seconds) and the words of each beat in one language. */
export function vtt(beats, words, locale, endAt) {
  const cues = beats
    .map((b, i) => ({ text: words[b.id]?.[locale], start: b.at, end: Math.min(beats[i + 1]?.at ?? endAt, endAt) }))
    .filter((c) => c.text && c.end > c.start + 0.2);
  const blocks = cues.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end - 0.1)}\n${c.text}\n`);
  return `WEBVTT\n\n${blocks.join("\n")}`;
}

/** Output time of a capture time, with the spans `[from, to, speed]` played faster. */
export function retime(t, spans) {
  let out = 0;
  let cursor = 0;
  for (const [from, to, speed] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (t <= from) break;
    out += from - cursor;
    out += (Math.min(t, to) - from) / speed;
    cursor = Math.min(t, to);
    if (t <= to) return out;
    cursor = to;
  }
  return out + (t - cursor);
}

const SPEECH_RATE = { en: 175, fr: 165 };

export async function createTake({
  chromium,
  base,
  viewport,
  scale = 2,
  locale,
  outDir,
  name,
  colorScheme = "dark",
  mobile = false,
  storageState,
  words = {},
  voices = {},
}) {
  mkdirSync(outDir, { recursive: true });
  const frameDir = path.join(outDir, `.frames-${name}`);
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    locale: locale === "fr" ? "fr-CA" : "en-CA",
    timezoneId: "America/Toronto",
    colorScheme,
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
    ...(storageState ? { storageState } : {}),
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("kz-theme", "dark");
    } catch {}
    // Nothing personal on screen: a short element showing the account's e-mail address is hidden (documents are redacted copies).
    const hide = () => {
      for (const el of document.querySelectorAll("body *")) {
        const text = el.textContent ?? "";
        if (el.childElementCount === 0 && text.length < 80 && /@[a-z0-9.\u2026-]+/i.test(text))
          el.style.visibility = "hidden";
      }
    };
    document.addEventListener("DOMContentLoaded", () => {
      hide();
      new MutationObserver(hide).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  });
  const page = await context.newPage();
  const frames = [];
  const beats = [];
  const spans = [];
  const calls = [];
  let t0 = null;
  let wallT0 = null;
  page.on("response", (res) => {
    const url = new URL(res.url());
    if (url.pathname.startsWith("/api/"))
      calls.push({
        method: res.request().method(),
        path: url.pathname,
        status: res.status(),
        requestId: res.headers()["x-request-id"] ?? null,
      });
  });
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    if (t0 === null) {
      t0 = metadata.timestamp;
      wallT0 = Date.now();
    }
    frames.push({ t: metadata.timestamp - t0, data });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  // The clock of the take is the wall clock since the first frame (the screencast sends nothing while the page is still).
  const now = () => (wallT0 === null ? 0 : (Date.now() - wallT0) / 1000);
  // How long each sentence takes to say (the voice is rendered once; the walkthrough waits at least that long on its beat).
  const speech = {};
  const sayDir = path.join(frameDir, "say");
  mkdirSync(sayDir, { recursive: true });
  for (const [id, w] of Object.entries(words)) {
    if (!w[locale]) continue;
    const f = path.join(sayDir, `${id}.aiff`);
    execFileSync("say", ["-v", voices[locale], "-r", String(SPEECH_RATE[locale]), "-o", f, w[locale]]); // NOSONAR S4036: a developer-machine script, PATH is the developer's own
    speech[id] = Number(
      execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]) // NOSONAR S4036: a developer-machine script, PATH is the developer's own
        .toString()
        .trim(),
    ); // NOSONAR S4036: a developer-machine script, PATH is the developer's own
  }
  const beatAt = {};
  const take = {
    page,
    context,
    calls,
    async start() {
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 88,
        maxWidth: viewport.width * scale,
        maxHeight: viewport.height * scale,
        everyNthFrame: 1,
      });
    },
    beat: (id) => {
      beats.push({ id, at: now() });
      beatAt[id] = now();
    },
    /** Waits until the sentence of this beat has been said (plus a breath): the picture never runs ahead of the words. */
    async speak(id) {
      // Measured on the output clock: a sped-up wait counts for what it lasts in the clip.
      const elapsed = retime(now(), spans) - retime(beatAt[id] ?? now(), spans);
      const need = ((speech[id] ?? 0) + 0.7 - elapsed) * 1000;
      if (need > 0) await page.waitForTimeout(need);
    },
    /** Marks a wait to be played at `speed`×; call `end()` when the wait is over. */
    fast(speed) {
      const from = now();
      return () => spans.push([from, now(), speed]);
    },
    async finish({ voice = false } = {}) {
      const end = Math.max(now() + 0.4, (frames.at(-1)?.t ?? 0) + 0.2);
      await cdp.send("Page.stopScreencast").catch(() => {});
      await browser.close();
      let list = "";
      frames.forEach((f, i) => {
        const file = path.join(frameDir, `${pad(i, 5)}.jpg`);
        writeFileSync(file, Buffer.from(f.data, "base64"));
        const next = frames[i + 1]?.t ?? end;
        const dt = retime(next, spans) - retime(f.t, spans) || 1 / 120;
        list += `file '${file}'\nduration ${Math.max(dt, 1 / 120).toFixed(5)}\n`;
      });
      const lastFrame = path.join(frameDir, `${pad(frames.length - 1, 5)}.jpg`);
      list += `file '${lastFrame}'\n`;
      writeFileSync(path.join(frameDir, "list.txt"), list);
      const outEnd = retime(end, spans);
      const outBeats = beats.map((b) => ({ id: b.id, at: Number(retime(b.at, spans).toFixed(3)) }));
      const base0 = path.join(outDir, name);
      const input = ["-f", "concat", "-safe", "0", "-i", path.join(frameDir, "list.txt")];
      const ff = (...a) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a], { stdio: "inherit" }); // NOSONAR S4036: a developer-machine script, PATH is the developer's own
      const vf = `fps=30,scale=${Math.round(viewport.width * (mobile ? 2 : 1))}:-2:flags=lanczos`;
      ff(
        ...input,
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-crf",
        "21",
        "-preset",
        "slow",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        `${base0}.mp4`,
      );
      ff(...input, "-vf", vf, "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1", `${base0}.webm`);
      ff(
        "-i",
        `${base0}.mp4`,
        "-ss",
        String(Math.min(outEnd - 0.2, outBeats.at(-1)?.at ?? 1)),
        "-frames:v",
        "1",
        "-q:v",
        "3",
        `${base0}.jpg`,
      );
      writeFileSync(`${base0}.${locale}.vtt`, vtt(outBeats, words, locale, outEnd));
      if (voice) {
        // One voice-over: each beat's sentence starts at its beat; the picture is held if a sentence runs long (never cut).
        const parts = outBeats
          .filter((b) => words[b.id]?.[locale])
          .map((b, i) => {
            return { at: b.at, aiff: path.join(sayDir, `${b.id}.aiff`) };
          });
        const args = [];
        parts.forEach((p) => args.push("-i", p.aiff));
        const delays = parts
          .map((p, i) => `[${i + 1}:a]adelay=${Math.round(p.at * 1000)}|${Math.round(p.at * 1000)}[a${i}]`)
          .join(";");
        const inputs = parts.map((_, i) => `[a${i}]`).join("");
        const filter = `${delays};${inputs}amix=inputs=${parts.length}:normalize=0[voice]`;
        ff(
          "-i",
          `${base0}.mp4`,
          ...args,
          "-filter_complex",
          filter,
          "-map",
          "0:v",
          "-map",
          "[voice]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-shortest",
          `${base0}.narrated.mp4`,
        );
      }
      rmSync(frameDir, { recursive: true, force: true });
      const gaps = frames
        .slice(1)
        .map((f, i) => f.t - frames[i].t)
        .filter((g) => g < 0.1);
      const activeFps = gaps.length / gaps.reduce((s, g) => s + g, 0);
      const meta = {
        name,
        locale,
        viewport,
        scale,
        seconds: Number(outEnd.toFixed(1)),
        activeCaptureFps: Number(activeFps.toFixed(1)),
        speedUps: spans.map(([a, b, s]) => ({ capturedSeconds: Number((b - a).toFixed(1)), speed: s })),
        beats: outBeats,
        calls,
      };
      writeFileSync(`${base0}.json`, `${JSON.stringify(meta, null, 2)}\n`);
      return meta;
    },
  };
  return take;
}
