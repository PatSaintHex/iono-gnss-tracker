/**
 * Cloudflare Worker: Proxy Serverless para GNSSPlanning (Trimble) y CORS
 * 
 * Permite que tu frontend alojado en GitHub Pages consulte los datos de 
 * TEC y Centelleo en tiempo real sin restricciones de CORS ni errores de Referer.
 * 
 * Despliegue en 2 minutos (100% Gratuito):
 * 1. Entra a https://dash.cloudflare.com y crea una cuenta gratis si no tenés una.
 * 2. En el menú izquierdo ve a: Compute (Workers) -> Workers & Pages -> Create Application -> Create Worker.
 * 3. Ponle de nombre "geo-proxy" y dale a "Deploy".
 * 4. Haz clic en "Edit Code", reemplaza todo el archivo worker.js con este contenido y pulsa "Deploy".
 * 5. Copia la URL pública generada (ej: https://geo-proxy.tunombre.workers.dev) y pégala
 *    en tu web en GitHub Pages haciendo clic en "⚙️ CONFIG PROXY".
 */

export default {
  async fetch(request, env, ctx) {
    // 1. Manejo de Preflight CORS para navegadores
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Accept, User-Agent",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);

    // 2. Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        message: "Proxy Geo-Ionosfera activo en Cloudflare Workers",
        timestamp: new Date().toISOString()
      }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        },
      });
    }

    // 3. Extracción de parámetros: /api/ionoindex o en raíz
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    const start = url.searchParams.get("start");
    const hours = url.searchParams.get("hours") || "24";
    const interval = url.searchParams.get("interval") || "600";

    if (!lat || !lon || !start) {
      return new Response(JSON.stringify({
        error: "Faltan parámetros obligatorios: lat, lon, start"
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        },
      });
    }

    // 4. Petición a Trimble GNSSPlanning inyectando el Referer obligatorio
    const targetUrl = `https://gnssplanning.com/api/ionoindex/${encodeURIComponent(lon)}/${encodeURIComponent(lat)}/${encodeURIComponent(start)}/${encodeURIComponent(hours)}/${encodeURIComponent(interval)}`;

    try {
      const upstream = await fetch(targetUrl, {
        headers: {
          "Accept": "application/json",
          "Referer": "https://gnssplanning.com/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        cf: {
          cacheTtl: 300, // Cache de 5 minutos en el CDN global de Cloudflare
          cacheEverything: true,
        },
      });

      if (!upstream.ok) {
        return new Response(JSON.stringify({
          error: `GNSSPlanning respondió HTTP ${upstream.status}`
        }), {
          status: upstream.status,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*"
          },
        });
      }

      const payload = await upstream.text();
      return new Response(payload, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        error: `Error conectando a GNSSPlanning: ${error.message}`
      }), {
        status: 502,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        },
      });
    }
  },
};
