#!/usr/bin/env node
// ─────────────────────────────────────────────────
// FalSprite showcase processor
// Runs BRIA background removal → transparent PNG → animated GIF
// Usage: node process-showcase.mjs --key YOUR_FAL_KEY [--concurrency 5] [--gif-size 200]
// ─────────────────────────────────────────────────

import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pkg from "gifenc";
const { GIFEncoder, quantize, applyPalette } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.join(__dirname, "public", "showcase");
const SHOWCASE_JSON = path.join(__dirname, "public", "showcase.json");

const REMOVE_BG_ENDPOINT = "fal-ai/bria/background/remove";
const DEFAULT_GRID = 4;

// Adaptive FPS: fewer frames = slower to appreciate each one
function gifFpsForGrid() {
  return 16;
}

// ── CLI args ──────────────────────────────────

function parseArgs() {
  const raw = process.argv.slice(2);
  const map = {};
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].startsWith("--") && i + 1 < raw.length && !raw[i + 1].startsWith("--")) {
      map[raw[i].slice(2)] = raw[i + 1];
      i++;
    }
  }
  return map;
}

const args = parseArgs();
const API_KEY = args.key || "";
const CONCURRENCY = Math.max(1, Math.min(10, parseInt(args.concurrency || "5", 10)));
const FRAME_SIZE = Math.max(64, Math.min(512, parseInt(args["gif-size"] || "200", 10)));
const REGEN_GIF = "regen-gif" in args;

if (!API_KEY) {
  console.error("Usage: node process-showcase.mjs --key YOUR_FAL_KEY [--concurrency 5] [--gif-size 200]");
  process.exit(1);
}

// ── FAL API helpers ───────────────────────────

async function uploadToFalStorage(buffer, contentType, filename) {
  const initRes = await fetch("https://rest.alpha.fal.ai/storage/upload/initiate", {
    method: "POST",
    headers: {
      "Authorization": `Key ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file_name: filename, content_type: contentType })
  });

  if (!initRes.ok) throw new Error(`Storage initiate failed (${initRes.status})`);
  const { upload_url, file_url } = await initRes.json();

  const putRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buffer
  });

  if (!putRes.ok) throw new Error(`Storage PUT failed (${putRes.status})`);
  return file_url;
}

async function removeBackground(imageUrl) {
  const res = await fetch(`https://fal.run/${REMOVE_BG_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ image_url: imageUrl })
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) throw new Error(`BRIA failed (${res.status})`);

  const url = data?.image?.url;
  if (!url) throw new Error("BRIA returned no image URL");
  return url;
}

async function downloadImage(url) {
  const res = await fetch(url, {
    headers: { "Authorization": `Key ${API_KEY}` }
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// ── GIF creation ──────────────────────────────

async function createGifFromSprite(spriteBuffer, frameSize, gridSize) {
  const g = gridSize || DEFAULT_GRID;
  const totalFrames = g * g;
  const meta = await sharp(spriteBuffer).metadata();
  const fw = Math.floor(meta.width / g);
  const fh = Math.floor(meta.height / g);

  const gif = GIFEncoder();
  const fps = gifFpsForGrid(g);
  const delay = Math.round(1000 / fps);

  // Sentinel color for transparent pixels (bright magenta)
  const SR = 255, SG = 0, SB = 255;

  for (let i = 0; i < totalFrames; i++) {
    const col = i % g;
    const row = Math.floor(i / g);

    // Extract frame, resize, get raw RGBA
    const rgba = await sharp(spriteBuffer)
      .extract({ left: col * fw, top: row * fh, width: fw, height: fh })
      .resize(frameSize, frameSize, { kernel: "nearest" })
      .ensureAlpha()
      .raw()
      .toBuffer();

    // Clean edges: remove white fringe by eroding 2px from transparent border
    const w = frameSize;
    const h = frameSize;
    let mask = new Uint8Array(w * h); // 1 = transparent

    // Mark transparent pixels (high threshold)
    for (let p = 0; p < rgba.length; p += 4) {
      if (rgba[p + 3] < 200) mask[p / 4] = 1;
    }

    // Erode 2 passes: each pass removes 1px border around transparent area
    for (let pass = 0; pass < 2; pass++) {
      const next = new Uint8Array(mask);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (mask[idx]) continue;
          const touchesTransparent =
            (x > 0 && mask[idx - 1]) ||
            (x < w - 1 && mask[idx + 1]) ||
            (y > 0 && mask[idx - w]) ||
            (y < h - 1 && mask[idx + w]);
          if (touchesTransparent) next[idx] = 1;
        }
      }
      mask = next;
    }

    // Build final pixel data with sentinel for transparent
    const pixels = new Uint8Array(rgba.length);
    for (let p = 0; p < rgba.length; p += 4) {
      if (mask[p / 4]) {
        pixels[p] = SR;
        pixels[p + 1] = SG;
        pixels[p + 2] = SB;
        pixels[p + 3] = 255;
      } else {
        pixels[p] = rgba[p];
        pixels[p + 1] = rgba[p + 1];
        pixels[p + 2] = rgba[p + 2];
        pixels[p + 3] = 255;
      }
    }

    const palette = quantize(pixels, 256);
    const index = applyPalette(pixels, palette);

    // Find sentinel in palette for transparency
    let transparentIndex = 0;
    for (let pi = 0; pi < palette.length; pi++) {
      if (palette[pi][0] === SR && palette[pi][1] === SG && palette[pi][2] === SB) {
        transparentIndex = pi;
        break;
      }
    }

    gif.writeFrame(index, frameSize, frameSize, {
      palette,
      delay,
      transparent: true,
      transparentIndex
    });
  }

  gif.finish();
  return Buffer.from(gif.bytes());
}

// ── Process single item ───────────────────────

async function processItem(item, idx, total) {
  const spriteFile = path.join(__dirname, "public", item.spriteUrl);

  if (!existsSync(spriteFile)) {
    throw new Error(`File not found: ${item.spriteUrl}`);
  }

  const basename = path.basename(spriteFile, ".png");
  const transparentFile = path.join(SHOWCASE_DIR, `${basename}-transparent.png`);
  const gifFile = path.join(SHOWCASE_DIR, `${basename}.gif`);

  let transparentBuffer;
  const label = (item.prompt || "").slice(0, 42);

  // Step 1: Background removal
  if (item.transparentUrl && existsSync(transparentFile)) {
    process.stdout.write(`  [${idx + 1}/${total}] ${label}... cached→`);
    transparentBuffer = await readFile(transparentFile);
  } else {
    process.stdout.write(`  [${idx + 1}/${total}] ${label}... upload→`);

    const spriteBuffer = await readFile(spriteFile);
    const remoteUrl = await uploadToFalStorage(spriteBuffer, "image/png", path.basename(spriteFile));

    process.stdout.write("bria→");
    const transparentRemoteUrl = await removeBackground(remoteUrl);

    process.stdout.write("download→");
    transparentBuffer = await downloadImage(transparentRemoteUrl);
    await writeFile(transparentFile, transparentBuffer);

    item.transparentUrl = `/showcase/${basename}-transparent.png`;
  }

  // Step 2: Create animated GIF
  const gridSize = item.gridSize || DEFAULT_GRID;
  if (item.gifUrl && existsSync(gifFile) && !REGEN_GIF) {
    console.log(`gif(cached) ✓`);
  } else {
    process.stdout.write("gif→");
    const gifBuffer = await createGifFromSprite(transparentBuffer, FRAME_SIZE, gridSize);
    await writeFile(gifFile, gifBuffer);
    item.gifUrl = `/showcase/${basename}.gif`;

    const sizeKB = (gifBuffer.length / 1024).toFixed(0);
    console.log(`✓ ${sizeKB}KB`);
  }

  return item;
}

// ── Main ──────────────────────────────────────

async function main() {
  let items;
  try {
    const raw = await readFile(SHOWCASE_JSON, "utf-8");
    items = JSON.parse(raw);
  } catch {
    console.error("  Could not read showcase.json");
    process.exit(1);
  }

  console.log(`\n  FalSprite Showcase Processor`);
  console.log(`  ───────────────────────────`);
  console.log(`  Items: ${items.length}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  GIF frame size: ${FRAME_SIZE}px\n`);

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);

    const tasks = chunk.map((item, j) =>
      processItem(item, i + j, items.length)
        .then(updated => {
          completed++;
          return updated;
        })
        .catch(err => {
          failed++;
          console.log(` ✗ ${err.message.slice(0, 60)}`);
          return item;
        })
    );

    const results = await Promise.all(tasks);
    for (let j = 0; j < results.length; j++) {
      items[i + j] = results[j];
    }

    // Save progress after each chunk
    await writeFile(SHOWCASE_JSON, JSON.stringify(items, null, 2) + "\n");
  }

  console.log(`\n  Done: ${completed} processed, ${failed} failed`);
  console.log(`  File: ${SHOWCASE_JSON}\n`);
}

main().catch(err => {
  console.error(`\n  Fatal: ${err.message}\n`);
  process.exit(1);
});
