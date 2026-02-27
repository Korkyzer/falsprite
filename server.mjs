import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  REMOVE_BG_ENDPOINT,
  runDirectModel, runGeminiRewrite, runGeminiSprite, extractRewrittenPrompt, extractFirstImageUrl,
  pickErrorMessage, buildSpritePrompt, buildRewriteSystemPrompt,
  makeDefaultPrompt, validateHttpUrl
} from "./lib/fal.mjs";

loadEnv({ path: ".env.local" });
loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const MAX_BODY_BYTES = 12 * 1024 * 1024;

const NUM_WORDS = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };

const MIME_BY_EXT = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) { reject(new Error("Payload too large")); return; }
      if (chunks.length === 0) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function getApiKey(req, body = {}) {
  return (req.headers["x-fal-key"] || body?.apiKey || process.env.FAL_KEY || "").toString().trim();
}

// ── Handlers ────────────────────────────────────

async function handleUpload(req, res) {
  let body;
  try { body = await parseJsonBody(req); } catch (e) { sendJson(res, 400, { error: e.message }); return; }

  const { data, contentType } = body;
  if (!data || !contentType) { sendJson(res, 400, { error: "Missing data or contentType" }); return; }

  try {
    const safeMimeType = String(contentType || "image/png").trim();
    const safeData = String(data || "").trim();
    const url = `data:${safeMimeType};base64,${safeData}`;
    sendJson(res, 200, { url });
  } catch (e) {
    sendJson(res, 502, { error: e.message });
  }
}

async function handleGenerate(req, res) {
  let body;
  try { body = await parseJsonBody(req); } catch (e) { sendJson(res, 400, { error: e.message }); return; }

  const falKey = getApiKey(req, body);
  const referenceImageInput = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
  const hasReferenceImage = referenceImageInput.length > 0;
  const userPrompt = (typeof body.prompt === "string" && body.prompt.trim()) ? body.prompt.trim() : "";

  const originalPrompt = userPrompt
    ? userPrompt
    : (hasReferenceImage
      ? ""
      : makeDefaultPrompt());
  const gridSize = Math.max(2, Math.min(6, parseInt(body.gridSize, 10) || 4));
  const gridWord = NUM_WORDS[gridSize] || "four";
  const warnings = [];
  let rewrittenPrompt = originalPrompt;

  // LLM rewrite
  const rewriteResult = await runGeminiRewrite(
    hasReferenceImage
      ? (userPrompt
        ? `Analyze the provided reference image first, then design the character and choreograph a ${gridWord}-beat animation loop. Keep identity, outfit, silhouette, and palette grounded in the reference. Extra user direction: ${userPrompt}`
        : `Analyze the provided reference image first, then design the character and choreograph a ${gridWord}-beat animation loop. Keep identity, outfit, silhouette, and palette grounded in the reference.`)
      : `Design the character and choreograph a ${gridWord}-beat animation loop for: ${originalPrompt}`,
    buildRewriteSystemPrompt(gridSize),
    {
      maxOutputTokens: 420,
      temperature: 0.65,
      referenceImageInput,
      falApiKey: falKey
    }
  );

  if (rewriteResult.ok) {
    const candidate = extractRewrittenPrompt(rewriteResult.data);
    if (candidate) rewrittenPrompt = candidate;
    else warnings.push("Rewrite returned unexpected format. Original prompt kept.");
  } else {
    warnings.push(`Rewrite skipped: ${pickErrorMessage(rewriteResult.data, "Rewrite failed")}`);
  }

  // Sprite generation
  const spritePromptBase = buildSpritePrompt(rewrittenPrompt, gridSize);
  const spritePrompt = hasReferenceImage
    ? `${spritePromptBase}\n\nREFERENCE IMAGE REQUIREMENT: The uploaded reference image is the source of truth for character identity, proportions, outfit, and color palette. Keep these traits consistent in every cell while animating this same character.`
    : spritePromptBase;
  const spriteResult = await runGeminiSprite(spritePrompt, referenceImageInput, falKey);

  if (!spriteResult.ok) {
    sendJson(res, spriteResult.status, { error: pickErrorMessage(spriteResult.data, "Sprite generation failed"), warnings });
    return;
  }

  const spriteUrl = typeof spriteResult.data?.image?.url === "string" ? spriteResult.data.image.url : "";
  if (!spriteUrl) {
    sendJson(res, 502, { error: "No image URL in sprite result", warnings });
    return;
  }

  // Background removal
  let transparentSpriteUrl = "";
  if (falKey) {
    const removeBgResult = await runDirectModel(falKey, REMOVE_BG_ENDPOINT, { image_url: spriteUrl });
    if (removeBgResult.ok) {
      transparentSpriteUrl = extractFirstImageUrl(removeBgResult.data);
      if (!transparentSpriteUrl) warnings.push("BG removal succeeded but no output URL.");
    } else {
      warnings.push(`BG removal skipped: ${pickErrorMessage(removeBgResult.data, "BRIA failed")}`);
    }
  } else {
    warnings.push("BG removal skipped: missing FAL_KEY.");
  }

  sendJson(res, 200, {
    promptOriginal: originalPrompt,
    promptRewritten: rewrittenPrompt,
    spriteUrl,
    transparentSpriteUrl,
    warnings,
    metadata: { grid: `${gridSize}x${gridSize}`, gridSize, resolution: "2K" }
  });
}

async function handleFalMedia(req, res, urlObject) {
  const mediaUrl = (urlObject.searchParams.get("url") || "").trim();
  if (!validateHttpUrl(mediaUrl)) { sendJson(res, 400, { error: "Invalid media URL" }); return; }

  const apiKey = getApiKey(req);
  try {
    const headers = {};
    if (apiKey) headers.Authorization = `Key ${apiKey}`;
    const response = await fetch(mediaUrl, { headers });
    if (!response.ok) { sendJson(res, response.status, { error: "Unable to fetch media" }); return; }
    const buffer = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, {
      "Content-Type": response.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Length": buffer.length
    });
    res.end(buffer);
  } catch {
    sendJson(res, 502, { error: "Unable to proxy media" });
  }
}

async function serveStatic(req, res, urlObject) {
  const requestPath = urlObject.pathname === "/" ? "/index.html" : urlObject.pathname;
  const normalized = path.normalize(requestPath).replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) { sendText(res, 403, "Forbidden"); return; }

  try {
    const file = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_BY_EXT[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(file);
  } catch {
    sendText(res, 404, "Not found");
  }
}

// ── Server ──────────────────────────────────────

const server = createServer(async (req, res) => {
  const urlObject = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fal-key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method === "GET" && urlObject.pathname === "/health") { sendJson(res, 200, { ok: true }); return; }
  if (req.method === "POST" && urlObject.pathname === "/api/upload") { await handleUpload(req, res); return; }
  if (req.method === "POST" && urlObject.pathname === "/api/generate") { await handleGenerate(req, res); return; }
  if (req.method === "GET" && urlObject.pathname === "/api/fal/media") { await handleFalMedia(req, res, urlObject); return; }

  if (req.method === "POST" && urlObject.pathname === "/api/showcase") {
    try {
      const body = await parseJsonBody(req);
      if (!Array.isArray(body)) { sendJson(res, 400, { error: "Body must be a JSON array" }); return; }
      await writeFile(path.join(PUBLIC_DIR, "showcase.json"), JSON.stringify(body, null, 2) + "\n");
      sendJson(res, 200, { ok: true, count: body.length });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  await serveStatic(req, res, urlObject);
});

server.listen(PORT, () => {
  console.log(`FalSprite running on http://localhost:${PORT}`);
});
