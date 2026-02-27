export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const body = req.body || {};
  const { data, contentType } = body;
  if (!data || !contentType) { res.status(400).json({ error: "Missing data or contentType" }); return; }

  try {
    const safeMimeType = String(contentType || "image/png").trim();
    const safeData = String(data || "").trim();
    const url = `data:${safeMimeType};base64,${safeData}`;
    res.status(200).json({ url });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
}
