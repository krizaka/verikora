# ADR-0010 — Photos of documents: cleaned locally, read locally first (two modules, three ports)

Status: accepted (2026-10-22). Issue: krizaka/verikora#201.

## Context
People photograph a lease or an invoice with their phone. A photo is not a PDF: it is crooked, dark, full of metadata
(GPS, device — Loi 25), and its text must be read. An Sovkora run costs; a local reading costs nothing.

## Decision
- **Pre-flight accepts PNG, JPEG and HEIC** (`lib/preflight`, rules as data): the real type by magic bytes, and a pixel limit
  read from the header (`maxImagePixels`, 40 MP) so a decompression bomb is refused before any decoder runs.
- **`lib/images/` (generic, no import from the app)** — port `ImageCleaner`: the camera's orientation applied, the page
  turned level (projection-profile skew, the desk's border region ignored), cropped to the page when there is one, grey with
  its contrast stretched, **every piece of metadata dropped**. It first reads a few facts — the device label, the last
  editing software, the dates, whether a GPS position was there (**never the position**) — reported to the person, never a
  verdict. HEIC is decoded in WebAssembly (`heic-decode`): the prebuilt image library has no HEIC codec. Deterministic: the
  same photo gives the same page.
- **Several photos make ONE document**: `pagesToPdf` assembles the cleaned pages into a PDF, in order, with no clock and no
  random identifier, so the same photos give the same bytes (the pre-flight duplicate check recognises them). The stored file
  is that PDF; the original photos are never kept. In the upload, `?pages=1` (default) groups photos dropped together, `?pages=0`
  keeps them apart (the URL is the state).
- **`lib/ocr/` (generic)** — ports `OcrEngine` (Tesseract, French + English, in-process, free; one worker per document, ended
  when it is read) and `VisionReader` (a model's reading, asked **only** when the local confidence is under `minConfidence` or
  there are fewer than `minChars` characters; marked as the model's, with its run id). The rules are data (`rules.ts`).
  **No vision Studio exists in Sovkora yet** (sovkora-packs#100): `vision` is `null`, so a weak reading stays local and is
  flagged « low confidence ».
- **Where it is kept**: `documents.text_source` (migration 0017): `{ kind: "ocr", engine, confidence, photos, lowConfidence,
  origin }` or `{ kind: "vision", by: "sovkora", runId, model, localConfidence, photos, origin }`; null for a PDF or a text file.
- **Shown**: « Ce document » (source, reliability, device/software/dates as hints, « GPS removed »), the closing note (how
  the text was read, and that a misread digit can change the result — in plain words, no run id), and the signed report
  (`document.textSource`, covered by the signature).
- **Authenticity is not offered on a photo document**: the file is a PDF Verikora assembled, so file-level signals would describe
  Verikora (the API answers 422 `PHOTO_AUTHENTICITY`; the page says why).

## Consequences
- Memory: Tesseract measures ~160 MB resident in the 512 MB production image (checked by the container smoke in CI); a
  larger instance is the lever if concurrent uploads grow.
- The build's file tracing cannot see a worker thread's requires, so the Dockerfile carries Tesseract's packages and trained
  data whole (`/ocr` → `node_modules/.pnpm`); `scripts/ci-container-smoke.sh` proves it inside the image on every PR.
- Cost: local OCR is free; a vision call (later) is an Sovkora run, counted like any other.
- Deferred: authenticity signals specific to images beyond the facts above; the mobile camera flow (#155) reuses the same API.
