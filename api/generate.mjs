import {
  REMOVE_BG_ENDPOINT,
  runDirectModel, runGeminiRewrite, runGeminiSprite, extractRewrittenPrompt, extractFirstImageUrl,
  pickErrorMessage, buildSpritePrompt, buildRewriteSystemPrompt,
  makeDefaultPrompt
} from "../lib/fal.mjs";

const NUM_WORDS = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const body = req.body || {};
  const falKey = (req.headers["x-fal-key"] || body.apiKey || process.env.FAL_KEY || "").trim();
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
    res.status(spriteResult.status).json({ error: pickErrorMessage(spriteResult.data, "Sprite generation failed"), warnings });
    return;
  }

  const spriteUrl = typeof spriteResult.data?.image?.url === "string" ? spriteResult.data.image.url : "";
  if (!spriteUrl) {
    res.status(502).json({ error: "No image URL in sprite result", warnings });
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

  res.status(200).json({
    promptOriginal: originalPrompt,
    promptRewritten: rewrittenPrompt,
    spriteUrl,
    transparentSpriteUrl,
    warnings,
    metadata: { grid: `${gridSize}x${gridSize}`, gridSize, resolution: "2K" }
  });
}
