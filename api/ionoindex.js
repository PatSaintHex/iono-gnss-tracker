export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Parse parameters from query string (req.query) or fallback to URL
  const query = req.query || {};
  let lat = query.lat;
  let lon = query.lon;
  let start = query.start;
  let hours = query.hours || "24";
  let interval = query.interval || "600";

  if (!lat || !lon || !start) {
    try {
      const parsedUrl = new URL(req.url, `https://${req.headers.host || "localhost"}`);
      lat = lat || parsedUrl.searchParams.get("lat");
      lon = lon || parsedUrl.searchParams.get("lon");
      start = start || parsedUrl.searchParams.get("start");
      hours = hours || parsedUrl.searchParams.get("hours") || "24";
      interval = interval || parsedUrl.searchParams.get("interval") || "600";
    } catch { /* ignore fallback parsing errors */ }
  }

  if (!lat || !lon || !start) {
    return res.status(400).json({ error: "Faltan parámetros requeridos: lat, lon, start" });
  }

  const targetUrl = `https://gnssplanning.com/api/ionoindex/${encodeURIComponent(lon)}/${encodeURIComponent(lat)}/${encodeURIComponent(start)}/${encodeURIComponent(hours)}/${encodeURIComponent(interval)}`;

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "Accept": "application/json",
        "Referer": "https://gnssplanning.com/",
        "User-Agent": "GeoIonosphereVercel/1.0",
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Trimble GNSSPlanning respondió HTTP ${upstream.status}`,
      });
    }

    const payload = await upstream.json();
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=60");
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(502).json({
      error: `Error conectando con Trimble GNSSPlanning: ${error.message}`,
    });
  }
}
