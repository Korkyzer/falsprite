# FalSprite

Game-ready sprite sheet animations from a single text prompt. Built on [fal.ai](https://fal.ai) + Google Gemini.

![FalSprite](https://img.shields.io/badge/powered_by-fal.ai-e8607a) ![License](https://img.shields.io/badge/license-MIT-blue)

## What it does

Type a character description, pick a grid size, choose animation actions — FalSprite generates a full sprite sheet with transparent background and animated preview.

**Pipeline:**
- **Google Gemini 2.5 Flash-Lite** — intelligent prompt rewriting with character design + choreography
- **Google Gemini 2.5 Flash Image** — sprite sheet image generation (with optional reference image)
- **fal.ai BRIA** — automatic background removal

## Features

- **Configurable grid**: 2x2, 3x3, 4x4, 5x5, 6x6
- **Multi-action selection**: pick multiple animation actions per grid row (idle, walk, run, attack, cast, jump, dance, death, dodge, or custom)
- **LLM prompt rewrite**: your simple prompt becomes a detailed character + choreography direction
- **Auto background removal**: BRIA removes the background automatically
- **Live preview**: real-time frame-by-frame animation with FPS control
- **Downloads**: sprite sheet PNG, transparent PNG, animated GIF
- **Reference image**: upload a reference to guide the generation
- **Showcase examples**: curated animated GIF examples

## Quick start

```bash
git clone https://github.com/lovisdotio/falsprite.git
cd falsprite
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:8787](http://localhost:8787)

Set these env vars in `.env.local`:
- `GOOGLE_API_KEY` (for prompt enhancement + sprite generation via Gemini)
- `FAL_KEY` (for BRIA background removal on fal.ai)

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

The project includes Vercel-ready serverless functions in `api/` and static assets in `public/`.

## Project structure

```
├── public/           Static frontend
│   ├── index.html    Main app
│   ├── app.js        Frontend logic
│   ├── styles.css    Styles
│   ├── showcase/     Example GIFs
│   └── select.html   Showcase curation tool
├── api/              Vercel serverless functions
│   ├── generate.mjs  Sprite generation endpoint
│   ├── upload.mjs    Image upload endpoint
│   └── fal/media.mjs Media proxy endpoint
├── lib/fal.mjs       Shared FAL API helpers
├── server.mjs        Local dev server
├── batch-generate.mjs  Batch generation tool (dev)
└── process-showcase.mjs Showcase processor (dev)
```

## Tech stack

- **Frontend**: Vanilla JS, no framework, no build step
- **Backend**: Node.js (native HTTP server for dev, Vercel serverless for prod)
- **AI**: Google Gemini (rewrite + sprite generation) + fal.ai BRIA (background removal)
- **GIF**: gif.js (browser) + gifenc (server-side batch)

## License

MIT
