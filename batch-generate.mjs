#!/usr/bin/env node
// ─────────────────────────────────────────────────
// FalSprite batch generator
// Usage: node batch-generate.mjs [--count 10] [--grid 4] [--fresh]
// ─────────────────────────────────────────────────

import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { runGeminiSprite } from "./lib/fal.mjs";

loadEnv({ path: ".env.local" });
loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.join(__dirname, "public", "showcase");
const SHOWCASE_JSON = path.join(__dirname, "public", "showcase.json");

const REWRITE_MODEL = "gemini-2.5-flash-lite";
const MAX_CONCURRENT = 20;

// ── CLI args ──────────────────────────────────

function parseArgs() {
  const raw = process.argv.slice(2);
  const map = {};
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].startsWith("--")) {
      const key = raw[i].slice(2);
      if (i + 1 < raw.length && !raw[i + 1].startsWith("--")) {
        map[key] = raw[i + 1];
        i++;
      } else {
        map[key] = "true";
      }
    }
  }
  return map;
}

const args = parseArgs();
const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY || "").trim();
const COUNT = Math.max(1, Math.min(200, parseInt(args.count || "10", 10)));
const GRID = Math.max(2, Math.min(6, parseInt(args.grid || "4", 10)));
const FRESH = "fresh" in args;

const NUM_WORDS = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };

if (!GOOGLE_API_KEY) {
  console.error("Usage: set GOOGLE_API_KEY (in .env.local) then run node batch-generate.mjs [--count 10] [--grid 4] [--fresh]");
  process.exit(1);
}

// ── Prompt generation ─────────────────────────

const CHARACTERS = [
  // cute creatures
  "baby dragon", "fluffy cloud cat", "crystal fox", "bouncy slime",
  "chubby penguin knight", "tiny fire spirit", "leaf bunny", "cosmic hamster",
  "pudgy bear monk", "mini phoenix chick", "bubble frog mage", "thunder puppy",
  "sleepy moon bear", "peppy star rabbit", "cozy tea dragon", "sparkle unicorn",
  "pocket griffin", "dancing flame sprite", "rainbow fish warrior", "candy golem",
  // friendly adventurers
  "mushroom alchemist", "flower fairy", "little robot companion", "wind-up toy soldier",
  "cherry blossom deer", "jolly mushroom knight", "starry owl wizard", "honey bee ranger",
  "acorn squirrel scout", "cotton candy witch", "sunflower guardian", "pebble turtle sage",
  // cool but approachable
  "tiny samurai cat", "ice cream sorcerer", "aurora fox mage", "coral seahorse knight",
  "bamboo panda warrior", "clockwork bird", "jade rabbit monk", "pastel ghost",
  "bubblegum dragon", "cinnamon phoenix", "lavender wolf archer", "peach tree spirit",
  // big and gentle
  "gentle stone giant", "friendly forest golem", "giant cloud whale", "kind lava bear"
];

const STYLES = [
  "clean pixel art", "vibrant anime", "cel-shaded cartoon",
  "pastel dreamlike", "watercolor wash", "retro arcade",
  "cozy storybook", "chibi kawaii", "soft gradient",
  "neon glow", "hand-drawn sketch", "colorful flat design",
  "8-bit classic", "Studio Ghibli inspired", "pop art bright"
];

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generatePrompt() {
  return `${randomPick(CHARACTERS)}, ${randomPick(STYLES)}, isometric action RPG`;
}

// ── LLM rewrite ───────────────────────────────

function buildRewriteSystem() {
  const w = NUM_WORDS[GRID];
  return [
    "You are an animation director and character designer for a sprite sheet pipeline.",
    "Given a character concept, you MUST return exactly two sections, nothing else:",
    "",
    "CHARACTER: A vivid description of the character's appearance — body type, armor, weapons, colors, silhouette, art style. Be extremely specific and visual.",
    "",
    `CHOREOGRAPHY: A ${w}-beat continuous animation loop that showcases this specific character's personality and abilities. Each beat is one row of the sheet. The last beat must transition seamlessly back into the first.`,
    "For each beat, describe the body position, weight distribution, limb placement, and motion arc in one sentence.",
    "The choreography must feel natural and unique to THIS character — a mage animates differently than a knight, a dancer differently than a berserker.",
    "",
    "RULES:",
    "- Never use numbers or digits anywhere.",
    "- Never mention grids, pixels, frames, cells, or image generation.",
    "- Never mention sprite sheets or technical terms.",
    "- Write as if directing a real actor through a motion capture session.",
    `- The ${w} beats must form one fluid, looping performance.`
  ].join("\n");
}

async function rewritePrompt(basePrompt) {
  if (!GOOGLE_API_KEY) return basePrompt;

  const w = NUM_WORDS[GRID];
  try {
    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({
      model: REWRITE_MODEL,
      systemInstruction: buildRewriteSystem()
    });
    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{ text: `Design the character and choreograph a ${w}-beat animation loop for: ${basePrompt}` }]
      }],
      generationConfig: { maxOutputTokens: 420, temperature: 0.65 }
    });

    const text = result?.response?.text?.() || "";
    const cleaned = typeof text === "string" ? text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/g, "").trim() : "";
    return cleaned.length > 20 ? cleaned : basePrompt;
  } catch {
    return basePrompt;
  }
}

function buildSpritePrompt(basePrompt) {
  const w = NUM_WORDS[GRID];
  return [
    "STRICT TECHNICAL REQUIREMENTS FOR THIS IMAGE:",
    "",
    `FORMAT: A single image containing a ${w}-by-${w} grid of equally sized cells.`,
    "Every cell must be the exact same dimensions, perfectly aligned, with no gaps or overlap.",
    "",
    "FORBIDDEN: Absolutely no text, no numbers, no letters, no digits, no labels,",
    "no watermarks, no signatures, no UI elements anywhere in the image. The image must",
    "contain ONLY the character illustrations in the grid cells and nothing else.",
    "",
    "CONSISTENCY: The exact same single character must appear in every cell.",
    "Same proportions, same art style, same level of detail, same camera angle throughout.",
    "Isometric three-quarter view. Full body visible head to toe in every cell.",
    "Strong clean silhouette against a plain solid flat-color background.",
    "",
    "ANIMATION FLOW: The cells read left-to-right, top-to-bottom, like reading a page.",
    "This is one continuous motion sequence. Each cell shows the next moment in the movement.",
    "The transition between the last cell of one row and the first cell of the next row",
    `must be just as smooth as transitions within a row — no jumps, no resets.`,
    `Each row contains ${w} phases of the motion. The very last cell loops back seamlessly`,
    "to the very first cell.",
    "",
    "MOTION QUALITY: Show real weight and physics. Bodies shift weight between feet.",
    "Arms counterbalance legs. Torsos rotate into actions. Follow-through on every movement.",
    "No stiff poses — every cell must feel like a freeze-frame of fluid motion.",
    "",
    `CHARACTER AND ANIMATION DIRECTION: ${basePrompt}.`,
    "Choreograph a continuous looping animation that showcases this character's",
    `personality, fighting style, and signature abilities across all ${w} rows.`
  ].join("\n");
}

async function generateSprite(prompt) {
  const fullPrompt = buildSpritePrompt(prompt);
  const spriteResult = await runGeminiSprite(fullPrompt);
  if (!spriteResult.ok) {
    const msg = spriteResult.data?.error || `Generation failed (${spriteResult.status})`;
    throw new Error(msg);
  }
  const data = spriteResult.data?.image?.data;
  if (typeof data !== "string" || !data) throw new Error("No image data in result");
  return Buffer.from(data, "base64");
}

// ── Main ──────────────────────────────────────

async function main() {
  // Fresh mode: clear old showcase data
  if (FRESH) {
    console.log(`\n  Clearing old showcase data...`);
    if (existsSync(SHOWCASE_DIR)) {
      await rm(SHOWCASE_DIR, { recursive: true });
    }
    await writeFile(SHOWCASE_JSON, "[]\n");
  }

  await mkdir(SHOWCASE_DIR, { recursive: true });

  // Load existing showcase
  let existing = [];
  try {
    const raw = await readFile(SHOWCASE_JSON, "utf-8");
    existing = JSON.parse(raw);
  } catch { existing = []; }

  const startIndex = existing.length;

  console.log(`\n  FalSprite Batch Generator`);
  console.log(`  ────────────────────────`);
  console.log(`  Generating ${COUNT} sprites @ ${GRID}x${GRID} (${MAX_CONCURRENT} concurrent)\n`);

  const prompts = Array.from({ length: COUNT }, () => generatePrompt());
  const results = [];
  let completed = 0;
  let failed = 0;

  // Process in chunks
  for (let i = 0; i < prompts.length; i += MAX_CONCURRENT) {
    const chunk = prompts.slice(i, i + MAX_CONCURRENT);

    const tasks = chunk.map(async (prompt, j) => {
      const idx = startIndex + i + j;
      const slug = prompt.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
      const filename = `${String(idx).padStart(3, "0")}-${slug}.png`;
      const filepath = path.join(SHOWCASE_DIR, filename);

      try {
        process.stdout.write(`  [${completed + failed + 1}/${COUNT}] ${prompt.slice(0, 50)}...`);

        // Rewrite prompt via LLM
        const rewritten = await rewritePrompt(prompt);

        const imageBuffer = await generateSprite(rewritten);
        await writeFile(filepath, imageBuffer);
        const bytes = imageBuffer.length;
        completed++;
        console.log(` ✓ ${(bytes / 1024).toFixed(0)}KB`);

        return {
          prompt,
          promptRewritten: rewritten,
          spriteUrl: `/showcase/${filename}`,
          gridSize: GRID,
          generatedAt: new Date().toISOString()
        };
      } catch (err) {
        failed++;
        console.log(` ✗ ${err.message.slice(0, 60)}`);
        return null;
      }
    });

    const chunkResults = await Promise.all(tasks);
    for (const r of chunkResults) {
      if (r) results.push(r);
    }
  }

  // Update showcase.json
  const updated = [...existing, ...results];
  await writeFile(SHOWCASE_JSON, JSON.stringify(updated, null, 2) + "\n");

  console.log(`\n  Done: ${completed} succeeded, ${failed} failed`);
  console.log(`  Showcase: ${updated.length} total entries`);
  console.log(`  File: ${SHOWCASE_JSON}\n`);
}

main().catch(err => {
  console.error(`\n  Fatal: ${err.message}\n`);
  process.exit(1);
});
