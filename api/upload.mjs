import { uploadToFalStorage } from "../lib/fal.mjs";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const body = req.body || {};
  const apiKey = (req.headers["x-fal-key"] || body.apiKey || process.env.FAL_KEY || "").trim();
  if (!apiKey) { res.status(400).json({ error: "Missing FAL API key" }); return; }

  const { data, contentType, filename } = body;
  if (!data || !contentType) { res.status(400).json({ error: "Missing data or contentType" }); return; }

  try {
    const buffer = Buffer.from(data, "base64");
    const url = await uploadToFalStorage(apiKey, buffer, contentType, filename || "upload.png");
    res.status(200).json({ url });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
}
