const HISTORY_LIMIT = 16;

function getGridSize() {
  return parseInt(document.getElementById("gridSelect")?.value, 10) || 4;
}

function getTotalFrames(g) {
  return g * g;
}

function makeFrameOrder(g) {
  return Array.from({ length: g * g }, (_, i) => i);
}

const RANDOM_SUBJECTS = [
  "baby dragon",
  "crystal fox",
  "tiny samurai cat",
  "sparkle unicorn",
  "bamboo panda warrior",
  "honey bee ranger",
  "jolly mushroom knight",
  "thunder puppy"
];

const RANDOM_STYLES = [
  "clean pixel art",
  "Studio Ghibli inspired",
  "chibi kawaii",
  "pastel dreamlike",
  "cozy storybook",
  "hand-drawn sketch",
  "retro arcade"
];

const elements = {
  heroBadgeGrid: document.querySelector("#heroBadgeGrid"),
  pipelineText: document.querySelector("#pipelineText"),
  promptInput: document.querySelector("#promptInput"),
  gridSelect: document.querySelector("#gridSelect"),
  generateButton: document.querySelector("#generateButton"),
  surpriseButton: document.querySelector("#surpriseButton"),
  statusText: document.querySelector("#statusText"),
  resultSection: document.querySelector("#resultSection"),
  previewCanvas: document.querySelector("#previewCanvas"),
  frameLabel: document.querySelector("#frameLabel"),
  fpsInput: document.querySelector("#fpsInput"),
  playToggle: document.querySelector("#playToggle"),
  promptText: document.querySelector("#promptText"),
  warningText: document.querySelector("#warningText"),
  downloadSheetButton: document.querySelector("#downloadSheetButton"),
  downloadTransparentButton: document.querySelector("#downloadTransparentButton"),
  downloadGifButton: document.querySelector("#downloadGifButton"),
  historyStrip: document.querySelector("#historyStrip"),
  importButton: document.querySelector("#importButton"),
  imageFileInput: document.querySelector("#imageFileInput"),
  imagePreview: document.querySelector("#imagePreview"),
  imagePreviewImg: document.querySelector("#imagePreviewImg"),
  removeImageButton: document.querySelector("#removeImageButton")
};

const state = {
  generating: false,
  generateStartedAt: 0,
  current: {
    promptOriginal: "",
    promptRewritten: "",
    spriteUrl: "",
    transparentSpriteUrl: "",
    gifUrl: "",
    referenceImageUrl: "",
    gridSize: 4
  },
  preview: {
    image: null,
    objectUrl: "",
    playIndex: 0,
    playing: true,
    lastTick: 0,
    rafId: 0
  },
  objectUrls: []
};

const previewCtx = elements.previewCanvas.getContext("2d", { alpha: false });
previewCtx.imageSmoothingEnabled = false;

setStatus("Ready.");
drawPlaceholder();
wireEvents();
startAnimationLoop();

function wireEvents() {
  elements.generateButton.addEventListener("click", onGenerate);
  elements.surpriseButton.addEventListener("click", onSurprise);
  elements.playToggle.addEventListener("click", onTogglePlay);
  elements.downloadSheetButton.addEventListener("click", onDownloadSheet);
  elements.downloadTransparentButton.addEventListener("click", onDownloadTransparent);
  elements.downloadGifButton.addEventListener("click", onDownloadGif);
  elements.importButton.addEventListener("click", () => elements.imageFileInput.click());
  elements.imageFileInput.addEventListener("change", onImageSelected);
  elements.removeImageButton.addEventListener("click", onRemoveImage);
  elements.gridSelect.addEventListener("change", onGridChange);
  elements.previewCanvas.addEventListener("click", onPreviewClick);

  // Action chips — multi-select, max = grid rows
  document.querySelectorAll(".action-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const isAuto = chip.dataset.action === "";

      if (isAuto) {
        // "auto" clears all others
        document.querySelectorAll(".action-chip").forEach(c => c.classList.remove("is-active"));
        chip.classList.add("is-active");
      } else {
        // Deactivate "auto"
        const autoChip = document.querySelector('.action-chip[data-action=""]');
        if (autoChip) autoChip.classList.remove("is-active");

        if (chip.classList.contains("is-active")) {
          chip.classList.remove("is-active");
          // If nothing selected, re-activate auto
          if (getSelectedActions().length === 0) {
            if (autoChip) autoChip.classList.add("is-active");
          }
        } else {
          const maxActions = getGridSize();
          if (getSelectedActions().length >= maxActions) {
            // Flash counter to indicate max reached
            const counter = document.getElementById("actionCounter");
            if (counter) {
              counter.style.color = "var(--accent)";
              setTimeout(() => counter.style.color = "", 600);
            }
            return;
          }
          chip.classList.add("is-active");
        }
      }
      document.getElementById("customAction").value = "";
      updateActionCounter();
    });
  });

  document.getElementById("customAction").addEventListener("input", updateActionCounter);
  updateActionCounter();
}

function getSelectedActions() {
  const actions = [];
  document.querySelectorAll(".action-chip.is-active").forEach(chip => {
    if (chip.dataset.action) actions.push(chip.dataset.action);
  });
  const custom = document.getElementById("customAction")?.value.trim();
  if (custom) actions.push(custom);
  return actions;
}

function getSelectedAction() {
  const actions = getSelectedActions();
  return actions.length > 0 ? actions.join(", ") : "";
}

function updateActionCounter() {
  const counter = document.getElementById("actionCounter");
  if (!counter) return;
  const g = getGridSize();
  const count = getSelectedActions().length;
  counter.textContent = `${count}/${g} rows`;
  counter.style.color = count >= g ? "var(--accent)" : "";
}

function onGridChange() {
  const g = getGridSize();
  if (elements.heroBadgeGrid) elements.heroBadgeGrid.textContent = `${g}x${g}`;
  if (elements.pipelineText) elements.pipelineText.textContent = `${g}\u00d7${g} sheet \u00b7 2K resolution \u00b7 auto bg removal`;
  updateActionCounter();
}

async function onImageSelected() {
  const file = elements.imageFileInput.files[0];
  if (!file) return;

  setStatus("Preparing reference image...");

  try {
    state.current.referenceImageUrl = await fileToDataUrl(file);

    const localUrl = URL.createObjectURL(file);
    trackObjectUrl(localUrl);
    elements.imagePreviewImg.src = localUrl;
    elements.imagePreview.classList.remove("hidden");

    setStatus("Reference image ready. Generate when ready.", "success");
  } catch (error) {
    const msg = String(error?.message || "Unknown error");
    setStatus(`Upload failed: ${msg}. If this is a large image, try a smaller file.`, "error");
  }

  elements.imageFileInput.value = "";
}

function onRemoveImage() {
  state.current.referenceImageUrl = "";
  elements.imagePreview.classList.add("hidden");
  elements.imagePreviewImg.src = "";
  setStatus("ready");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(String(reader.result || ""));
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function setStatus(message, mode = "") {
  elements.statusText.textContent = message;
  elements.statusText.classList.remove("error", "success");
  if (mode) {
    elements.statusText.classList.add(mode);
  }
}

function randomPrompt() {
  const subject = RANDOM_SUBJECTS[Math.floor(Math.random() * RANDOM_SUBJECTS.length)];
  const style = RANDOM_STYLES[Math.floor(Math.random() * RANDOM_STYLES.length)];
  return `${subject}, ${style}, isometric action RPG animation`;
}

function onSurprise() {
  elements.promptInput.value = randomPrompt();
}

function onPreviewClick() {
  if (!state.preview.image) return;

  const existing = document.getElementById("showcaseOverlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "showcaseOverlay";
  overlay.className = "showcase-overlay";

  const inner = document.createElement("div");
  inner.className = "showcase-overlay-inner";
  inner.style.maxWidth = "700px";

  const closeBtn = document.createElement("button");
  closeBtn.className = "showcase-overlay-close";
  closeBtn.textContent = "\u00d7";
  closeBtn.addEventListener("click", (e) => { e.stopPropagation(); overlay.remove(); });

  const img = document.createElement("img");
  img.src = state.preview.objectUrl;
  img.alt = "Full sprite sheet";

  const g = state.current.gridSize;
  const info = document.createElement("div");
  info.className = "showcase-overlay-info";
  info.innerHTML = `<span class="showcase-overlay-badge">${g}x${g}</span><span class="showcase-overlay-prompt">${state.current.promptRewritten.split(/\s+/).slice(0, 12).join(" ")}</span>`;

  inner.appendChild(closeBtn);
  inner.appendChild(img);
  inner.appendChild(info);
  overlay.appendChild(inner);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

function onTogglePlay() {
  state.preview.playing = !state.preview.playing;
  elements.playToggle.textContent = state.preview.playing ? "Pause" : "Play";
}

async function onGenerate() {
  // Allow re-click after 5 seconds even if still generating
  if (state.generating && Date.now() - state.generateStartedAt < 5000) {
    return;
  }

  const hasReferenceImage = Boolean(state.current.referenceImageUrl);
  let prompt = elements.promptInput.value.trim();
  if (!prompt && !hasReferenceImage) {
    prompt = randomPrompt();
    elements.promptInput.value = prompt;
  }

  const gridSize = getGridSize();
  state.current.gridSize = gridSize;
  state.generating = true;
  state.generateStartedAt = Date.now();
  elements.generateButton.disabled = true;
  // Re-enable button after 5s so user can queue another
  setTimeout(() => {
    elements.generateButton.disabled = false;
  }, 5000);
  setStatus(`Generating ${gridSize}x${gridSize} sprite sheet...`);
  hideWarnings();

  // Show result section immediately with loading state
  elements.resultSection.classList.remove("hidden");
  elements.promptText.textContent = "rewriting prompt...";
  showCanvasLoader(true);

  try {
    const action = getSelectedAction();
    const fullPrompt = action
      ? (prompt ? `${prompt} — animation: ${action}` : `animation: ${action}`)
      : prompt;
    const payload = { prompt: fullPrompt, gridSize };
    if (state.current.referenceImageUrl) {
      payload.imageUrl = state.current.referenceImageUrl;
    }

    const data = await callJson("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    state.current.promptOriginal = data.promptOriginal || prompt;
    state.current.promptRewritten = data.promptRewritten || prompt;
    state.current.spriteUrl = data.spriteUrl || "";
    state.current.transparentSpriteUrl = data.transparentSpriteUrl || "";
    resetGifCache();

    elements.promptText.textContent = state.current.promptRewritten;
    updateWarnings(data.warnings || []);

    const previewSourceUrl = state.current.transparentSpriteUrl || state.current.spriteUrl;
    if (!previewSourceUrl) {
      throw new Error("No sprite URL returned.");
    }

    await loadPreviewImage(previewSourceUrl);

    showCanvasLoader(false);
    state.preview.playing = true;
    elements.playToggle.textContent = "Pause";

    setStatus("Done. Animation ready.", "success");

    void appendHistoryAnimation(state.preview.image, state.current.promptRewritten);
  } catch (error) {
    showCanvasLoader(false);
    setStatus(error.message, "error");
  } finally {
    state.generating = false;
    elements.generateButton.disabled = false;
  }
}

function toggleGenerateUI(disabled) {
  elements.generateButton.disabled = disabled;
  elements.downloadSheetButton.disabled = disabled;
  elements.downloadTransparentButton.disabled = disabled;
  elements.downloadGifButton.disabled = disabled;
  elements.promptInput.disabled = disabled;
}

async function loadPreviewImage(url) {
  const blob = await fetchMediaBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  trackObjectUrl(objectUrl);

  const image = await loadImage(objectUrl);

  state.preview.image = image;
  state.preview.objectUrl = objectUrl;
  state.preview.playIndex = 0;
  state.preview.lastTick = 0;

  drawFrame();
}

function showCanvasLoader(show) {
  let overlay = document.getElementById("canvasLoader");
  if (show) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "canvasLoader";
      overlay.className = "canvas-loader";
      overlay.innerHTML = `
        <div class="canvas-loader-inner">
          <div class="canvas-loader-grid"></div>
          <span>generating...</span>
        </div>
      `;
      const wrap = document.querySelector(".canvas-wrap");
      if (wrap) wrap.appendChild(overlay);
    }
    overlay.classList.add("is-active");
  } else {
    if (overlay) overlay.classList.remove("is-active");
  }
}

function drawPlaceholder() {
  previewCtx.fillStyle = "#16161e";
  previewCtx.fillRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height);
  previewCtx.fillStyle = "#4e4e58";
  previewCtx.font = "600 16px 'Space Mono', monospace";
  previewCtx.textAlign = "center";
  previewCtx.fillText("generate to preview", elements.previewCanvas.width / 2, elements.previewCanvas.height / 2);
  previewCtx.textAlign = "start";
}

function drawFrame() {
  const image = state.preview.image;
  if (!image) {
    drawPlaceholder();
    return;
  }

  const g = state.current.gridSize;
  const totalFrames = getTotalFrames(g);
  const frameOrder = makeFrameOrder(g);
  const frameId = frameOrder[state.preview.playIndex % frameOrder.length];
  const frameW = Math.floor(image.width / g);
  const frameH = Math.floor(image.height / g);

  const col = frameId % g;
  const row = Math.floor(frameId / g);

  previewCtx.fillStyle = "#16161e";
  previewCtx.fillRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height);

  const target = Math.floor(Math.min(elements.previewCanvas.width, elements.previewCanvas.height) * 0.86);
  const dx = Math.floor((elements.previewCanvas.width - target) / 2);
  const dy = Math.floor((elements.previewCanvas.height - target) / 2);

  previewCtx.imageSmoothingEnabled = false;
  previewCtx.drawImage(
    image,
    col * frameW,
    row * frameH,
    frameW,
    frameH,
    dx,
    dy,
    target,
    target
  );

  elements.frameLabel.textContent = `frame ${frameId + 1}/${totalFrames}`;
}

function startAnimationLoop() {
  const tick = (timestamp) => {
    if (state.preview.image && state.preview.playing) {
      const fps = Number.parseInt(elements.fpsInput.value, 10) || 12;
      const interval = 1000 / Math.max(1, fps);

      if (timestamp - state.preview.lastTick >= interval) {
        state.preview.lastTick = timestamp;
        const totalFrames = getTotalFrames(state.current.gridSize);
        state.preview.playIndex = (state.preview.playIndex + 1) % totalFrames;
        drawFrame();
      }
    }

    state.preview.rafId = window.requestAnimationFrame(tick);
  };

  state.preview.rafId = window.requestAnimationFrame(tick);
}

async function onDownloadSheet() {
  if (!state.current.spriteUrl) {
    setStatus("No sheet available yet.", "error");
    return;
  }
  const g = state.current.gridSize;
  await downloadFromFalUrl(state.current.spriteUrl, `sprite-sheet-${g}x${g}-2k.png`);
}

async function onDownloadTransparent() {
  if (!state.current.transparentSpriteUrl) {
    setStatus("Transparent sheet is not available for this generation.", "error");
    return;
  }
  const g = state.current.gridSize;
  await downloadFromFalUrl(state.current.transparentSpriteUrl, `sprite-sheet-${g}x${g}-2k-transparent.png`);
}

async function onDownloadGif() {
  const image = state.preview.image;
  if (!image) {
    setStatus("No animation available yet.", "error");
    return;
  }

  if (state.current.gifUrl) {
    triggerDownload(state.current.gifUrl, "sprite-animation-6x6.gif");
    return;
  }

  setStatus("Building GIF...");

  try {
    const g = state.current.gridSize;
    const fps = Number.parseInt(elements.fpsInput.value, 10) || 12;
    const blob = await createGifBlob(image, makeFrameOrder(g), fps, 560, g);
    const objectUrl = URL.createObjectURL(blob);
    trackObjectUrl(objectUrl);

    state.current.gifUrl = objectUrl;
    triggerDownload(objectUrl, `sprite-animation-${g}x${g}.gif`);
    setStatus("GIF downloaded.", "success");
  } catch (error) {
    setStatus(`GIF build failed: ${error.message}`, "error");
  }
}

function createGifBlob(image, frameOrder, fps, sizePx, gridSize) {
  const g = gridSize || 4;
  return new Promise((resolve, reject) => {
    if (typeof window.GIF !== "function") {
      reject(new Error("gif.js is not loaded"));
      return;
    }

    const frameW = Math.floor(image.width / g);
    const frameH = Math.floor(image.height / g);

    const canvas = document.createElement("canvas");
    canvas.width = sizePx;
    canvas.height = sizePx;

    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = false;

    const gif = new window.GIF({
      workers: 2,
      quality: 8,
      workerScript: "/gif.worker.js",
      width: sizePx,
      height: sizePx
    });

    const delay = Math.round(1000 / Math.max(1, fps));

    for (const frameId of frameOrder) {
      const col = frameId % g;
      const row = Math.floor(frameId / g);

      ctx.fillStyle = "#16161e";
      ctx.fillRect(0, 0, sizePx, sizePx);
      ctx.drawImage(
        image,
        col * frameW,
        row * frameH,
        frameW,
        frameH,
        24,
        24,
        sizePx - 48,
        sizePx - 48
      );

      gif.addFrame(ctx, { copy: true, delay });
    }

    gif.on("finished", (blob) => {
      resolve(blob);
    });

    gif.on("abort", () => {
      reject(new Error("GIF encoder aborted"));
    });

    gif.render();
  });
}

async function appendHistoryAnimation(image, prompt) {
  try {
    const g = state.current.gridSize;
    const blob = await createGifBlob(image, makeFrameOrder(g), 10, 240, g);
    const objectUrl = URL.createObjectURL(blob);
    trackObjectUrl(objectUrl);
    insertHistoryCard(objectUrl, prompt);
  } catch {
    const fallbackBlob = await renderStaticThumbnail(image, 240);
    const objectUrl = URL.createObjectURL(fallbackBlob);
    trackObjectUrl(objectUrl);
    insertHistoryCard(objectUrl, prompt);
  }
}

function renderStaticThumbnail(image, sizePx) {
  const g = state.current.gridSize;
  const frameW = Math.floor(image.width / g);
  const frameH = Math.floor(image.height / g);

  const canvas = document.createElement("canvas");
  canvas.width = sizePx;
  canvas.height = sizePx;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#16161e";
  ctx.fillRect(0, 0, sizePx, sizePx);
  ctx.drawImage(image, 0, 0, frameW, frameH, 16, 16, sizePx - 32, sizePx - 32);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Thumbnail failed"));
      }
    }, "image/png");
  });
}

function insertHistoryCard(url, prompt) {
  const card = document.createElement("article");
  card.className = "history-card";

  const img = document.createElement("img");
  img.src = url;
  img.alt = "Generated animation preview";

  const text = document.createElement("p");
  text.textContent = summarizePrompt(prompt);

  card.appendChild(img);
  card.appendChild(text);

  elements.historyStrip.prepend(card);

  while (elements.historyStrip.children.length > HISTORY_LIMIT) {
    elements.historyStrip.removeChild(elements.historyStrip.lastElementChild);
  }
}

function summarizePrompt(prompt) {
  return prompt.trim().split(/\s+/).slice(0, 8).join(" ");
}

function updateWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    hideWarnings();
    return;
  }

  elements.warningText.classList.remove("hidden");
  elements.warningText.textContent = warnings.join(" | ");
}

function hideWarnings() {
  elements.warningText.classList.add("hidden");
  elements.warningText.textContent = "";
}

function resetGifCache() {
  state.current.gifUrl = "";
}

async function downloadFromFalUrl(url, filename) {
  try {
    const blob = await fetchMediaBlob(url);
    const objectUrl = URL.createObjectURL(blob);
    trackObjectUrl(objectUrl);
    triggerDownload(objectUrl, filename);
    setStatus(`Downloaded ${filename}.`, "success");
  } catch (error) {
    setStatus(`Download failed: ${error.message}`, "error");
  }
}

function triggerDownload(objectUrl, filename) {
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
}

async function fetchMediaBlob(url) {
  if (typeof url === "string" && url.startsWith("data:image/")) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Data URL load failed (${response.status})`);
    return response.blob();
  }

  const response = await fetch(`/api/fal/media?url=${encodeURIComponent(url)}`);

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const message =
      (typeof errorPayload.error === "string" && errorPayload.error) ||
      `Media proxy failed (${response.status})`;
    throw new Error(message);
  }

  return response.blob();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image loading failed"));
    image.src = src;
  });
}

async function callJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detailText =
      Array.isArray(payload.detail) && payload.detail.length > 0
        ? payload.detail
            .map((item) => {
              if (typeof item === "string") {
                return item;
              }
              if (item && typeof item.msg === "string") {
                const path = Array.isArray(item.loc) ? item.loc.join(".") : "";
                return path ? `${path}: ${item.msg}` : item.msg;
              }
              return "";
            })
            .filter(Boolean)
            .join(" | ")
        : "";

    const message =
      detailText ||
      (typeof payload.error === "string" && payload.error) ||
      (typeof payload.raw === "string" && payload.raw) ||
      `Request failed (${response.status})`;

    throw new Error(message);
  }

  return payload;
}

function trackObjectUrl(url) {
  state.objectUrls.push(url);
}

window.addEventListener("beforeunload", () => {
  for (const url of state.objectUrls) {
    URL.revokeObjectURL(url);
  }
});

// ── Showcase ──────────────────────────────────

async function initShowcase() {
  try {
    const res = await fetch("/showcase.json");
    if (!res.ok) return;
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) return;

    const section = document.getElementById("showcaseSection");
    const grid = document.getElementById("showcaseGrid");
    if (!section || !grid) return;

    section.classList.remove("hidden");

    for (const item of items) {
      const card = buildShowcaseCard(item);
      grid.appendChild(card);
    }
  } catch {
    // showcase is optional
  }
}

function buildShowcaseCard(item) {
  const card = document.createElement("div");
  card.className = "showcase-card";

  const imgWrap = document.createElement("div");
  imgWrap.className = "showcase-img-wrap";

  // Static thumbnail: draw first frame of GIF onto canvas
  const canvas = document.createElement("canvas");
  canvas.className = "showcase-gif";
  canvas.width = 200;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#16161e";
  ctx.fillRect(0, 0, 200, 200);

  const gifSrc = item.gifUrl || "";
  if (gifSrc) {
    const tempImg = new Image();
    tempImg.onload = () => {
      ctx.drawImage(tempImg, 0, 0, 200, 200);
    };
    tempImg.src = gifSrc;
  }

  const g = item.gridSize || 4;
  const badge = document.createElement("span");
  badge.className = "showcase-grid-badge";
  badge.textContent = `${g}x${g}`;

  // Animated GIF layer (hidden by default, shown on hover)
  const animImg = document.createElement("img");
  animImg.className = "showcase-gif-anim";
  animImg.alt = "";
  if (gifSrc) animImg.src = gifSrc;

  imgWrap.appendChild(canvas);
  imgWrap.appendChild(animImg);
  imgWrap.appendChild(badge);

  // Hover to animate
  card.addEventListener("mouseenter", () => { animImg.style.opacity = "1"; });
  card.addEventListener("mouseleave", () => { animImg.style.opacity = "0"; });

  const label = document.createElement("p");
  label.textContent = (item.prompt || "").split(/\s+/).slice(0, 6).join(" ");

  card.appendChild(imgWrap);
  card.appendChild(label);

  card.addEventListener("click", () => openShowcaseOverlay(item));

  return card;
}

function openShowcaseOverlay(item) {
  const existing = document.getElementById("showcaseOverlay");
  if (existing) existing.remove();

  const g = item.gridSize || 4;
  const gifSrc = item.gifUrl || "";
  const prompt = item.prompt || "";

  // Set hero image
  const heroImg = document.getElementById("heroImage");
  if (heroImg && gifSrc) {
    heroImg.src = gifSrc;
    heroImg.classList.add("is-visible");
  }

  // Create overlay
  const overlay = document.createElement("div");
  overlay.id = "showcaseOverlay";
  overlay.className = "showcase-overlay";

  const inner = document.createElement("div");
  inner.className = "showcase-overlay-inner";

  const closeBtn = document.createElement("button");
  closeBtn.className = "showcase-overlay-close";
  closeBtn.textContent = "\u00d7";
  closeBtn.addEventListener("click", (e) => { e.stopPropagation(); overlay.remove(); });

  // Static canvas (first frame) + animated GIF on hover
  const imgWrapEl = document.createElement("div");
  imgWrapEl.className = "showcase-overlay-img-wrap";

  const staticCanvas = document.createElement("canvas");
  staticCanvas.className = "showcase-overlay-static";
  staticCanvas.width = 460;
  staticCanvas.height = 460;
  const sCtx = staticCanvas.getContext("2d");
  sCtx.fillStyle = "#16161e";
  sCtx.fillRect(0, 0, 460, 460);

  const animImg = document.createElement("img");
  animImg.className = "showcase-overlay-anim";
  animImg.alt = prompt;

  // Load first frame into canvas, keep GIF src ready
  const tempImg = new Image();
  tempImg.onload = () => {
    sCtx.drawImage(tempImg, 0, 0, 460, 460);
  };
  tempImg.src = gifSrc;

  imgWrapEl.appendChild(staticCanvas);
  imgWrapEl.appendChild(animImg);

  // Hover: show animated GIF, unhover: show static
  imgWrapEl.addEventListener("mouseenter", () => {
    animImg.src = gifSrc;
    animImg.style.opacity = "1";
    staticCanvas.style.opacity = "0";
  });
  imgWrapEl.addEventListener("mouseleave", () => {
    animImg.style.opacity = "0";
    staticCanvas.style.opacity = "1";
    animImg.src = "";
  });

  const info = document.createElement("div");
  info.className = "showcase-overlay-info";
  info.innerHTML = `<span class="showcase-overlay-badge">${g}x${g}</span><span class="showcase-overlay-prompt">${prompt}</span>`;

  inner.appendChild(closeBtn);
  inner.appendChild(imgWrapEl);
  inner.appendChild(info);
  overlay.appendChild(inner);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

initShowcase();

// ── Loader ────────────────────────────────────

const loaderStartTime = Date.now();
window.addEventListener("load", () => {
  const loader = document.getElementById("loader");
  if (!loader) return;
  const elapsed = Date.now() - loaderStartTime;
  const minVisible = 900;
  setTimeout(() => {
    loader.classList.add("is-gone");
    setTimeout(() => loader.remove(), 500);
  }, Math.max(0, minVisible - elapsed));
});
