import { validateHttpUrl } from "../../lib/fal.mjs";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  const mediaUrl = (req.query.url || "").trim();
  if (!validateHttpUrl(mediaUrl)) {
    res.status(400).json({ error: "Invalid media URL" });
    return;
  }

  const apiKey = (req.headers["x-fal-key"] || process.env.FAL_KEY || "").trim();

  try {
    const headers = {};
    if (apiKey) headers.Authorization = `Key ${apiKey}`;

    const response = await fetch(mediaUrl, { headers });
    if (!response.ok) {
      res.status(response.status).json({ error: "Unable to fetch media" });
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(buffer);
  } catch {
    res.status(502).json({ error: "Unable to proxy media" });
  }
}
