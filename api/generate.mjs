import {
  NANO_BANANA_ENDPOINT, NANO_BANANA_EDIT_ENDPOINT, REMOVE_BG_ENDPOINT,
  REWRITE_ENDPOINT, REWRITE_MODEL,
  runQueuedModel, runDirectModel, extractRewrittenPrompt, extractFirstImageUrl,
  pickErrorMessage, buildSpritePrompt, buildRewriteSystemPrompt,
  makeDefaultPrompt, validateHttpUrl
} from "../lib/fal.mjs";

const NUM_WORDS = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const body = req.body || {};
  const apiKey = (req.headers["x-fal-key"] || body.apiKey || "").trim();
  if (!apiKey) { res.status(400).json({ error: "Missing FAL API key" }); return; }

  const originalPrompt = (typeof body.prompt === "string" && body.prompt.trim()) ? body.prompt.trim() : makeDefaultPrompt();
  const gridSize = Math.max(2, Math.min(6, parseInt(body.gridSize, 10) || 4));
  const gridWord = NUM_WORDS[gridSize] || "four";
  const warnings = [];
  let rewrittenPrompt = originalPrompt;

  // LLM rewrite
  const rewriteResult = await runQueuedModel(apiKey, REWRITE_ENDPOINT, {
    model: REWRITE_MODEL,
    prompt: `Design the character and choreograph a ${gridWord}-beat animation loop for: ${originalPrompt}`,
    system_prompt: buildRewriteSystemPrompt(gridSize),
    max_tokens: 420,
    temperature: 0.65
  }, 120000);

  if (rewriteResult.ok) {
    const candidate = extractRewrittenPrompt(rewriteResult.data);
    if (candidate) rewrittenPrompt = candidate;
    else warnings.push("Rewrite returned unexpected format. Original prompt kept.");
  } else {
    warnings.push(`Rewrite skipped: ${pickErrorMessage(rewriteResult.data, "Rewrite failed")}`);
  }

  // Sprite generation
  const spritePrompt = buildSpritePrompt(rewrittenPrompt, gridSize);
  const referenceImageUrl = typeof body.imageUrl === "string" && validateHttpUrl(body.imageUrl) ? body.imageUrl : "";

  const spriteInput = referenceImageUrl
    ? { prompt: spritePrompt, image_urls: [referenceImageUrl], aspect_ratio: "1:1", resolution: "2K", num_images: 1, output_format: "png", safety_tolerance: 2 }
    : { prompt: spritePrompt, aspect_ratio: "1:1", resolution: "2K", num_images: 1, output_format: "png", safety_tolerance: 2, expand_prompt: true };

  const spriteEndpoint = referenceImageUrl ? NANO_BANANA_EDIT_ENDPOINT : NANO_BANANA_ENDPOINT;
  const spriteResult = await runQueuedModel(apiKey, spriteEndpoint, spriteInput, 240000);

  if (!spriteResult.ok) {
    res.status(spriteResult.status).json({ error: pickErrorMessage(spriteResult.data, "Sprite generation failed"), warnings });
    return;
  }

  const spriteUrl = extractFirstImageUrl(spriteResult.data);
  if (!spriteUrl) {
    res.status(502).json({ error: "No image URL in sprite result", warnings });
    return;
  }

  // Background removal
  let transparentSpriteUrl = "";
  const removeBgResult = await runDirectModel(apiKey, REMOVE_BG_ENDPOINT, { image_url: spriteUrl });
  if (removeBgResult.ok) {
    transparentSpriteUrl = extractFirstImageUrl(removeBgResult.data);
    if (!transparentSpriteUrl) warnings.push("BG removal succeeded but no output URL.");
  } else {
    warnings.push(`BG removal skipped: ${pickErrorMessage(removeBgResult.data, "BRIA failed")}`);
  }

  res.status(200).json({
    promptOriginal: originalPrompt,
    promptRewritten: rewrittenPrompt,
    spriteUrl,
    transparentSpriteUrl,
    warnings,
    metadata: { grid: `${gridSize}x${gridSize}`, gridSize, resolution: "2K" }
  });
}
