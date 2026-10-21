# GeoIonosfera — Monitor de Clima Espacial y GNSS

Monitor web en tiempo real para observación geomagnética (NOAA SWPC) y comportamiento ionosférico TEC / Centelleo (Trimble GNSSPlanning) orientado a posicionamiento satelital de alta precisión (RTK).

---

## 🚀 Despliegue en Vercel (100% Automático y En Vivo)

Este proyecto está optimizado con una **Serverless Function en `/api/ionoindex.js`** que resuelve el enlace directo con Trimble en la nube sin necesidad de configurar proxies ni servidores dedicados.

### Pasos para desplegar:
1. Inicia sesión en **[vercel.com](https://vercel.com/)** con tu cuenta de GitHub.
2. Haz clic en **"Add New..."** -> **"Project"**.
3. Selecciona el repositorio **`iono-gnss-tracker`**.
4. Haz clic en **"Deploy"** (no requiere configurar variables ni comandos de build).
5. En 30 segundos obtendrás tu URL pública HTTPS (ejemplo: `https://iono-gnss-tracker.vercel.app`).

---

## 🛰️ Arquitectura

- **Frontend:** HTML5, CSS3 responsive, Vanilla JavaScript (ES Modules) y Canvas 2D de alto rendimiento.
- **Backend Serverless:** `/api/ionoindex.js` en Vercel (Node.js Edge / Serverless) que consulta la API de Trimble GNSSPlanning inyectando las cabeceras de servidor requeridas.
- **NOAA SWPC:** Consulta directa desde el cliente al pronóstico de 3 días de tormentas geomagnéticas (escalas G1 a G5).
- **Offline / PWA:** Almacenamiento local de consultas históricas en IndexedDB y Service Worker.
