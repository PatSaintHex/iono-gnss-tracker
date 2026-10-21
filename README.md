# GeoIonosfera — Versión GitHub Pages (100% Serverless / Cliente)

Esta carpeta (`WEB_github`) es una **versión independiente** diseñada específicamente para publicarse en **GitHub Pages** (o cualquier hosting estático como Netlify, Vercel o Cloudflare Pages) sin necesidad de mantener un servidor Python encendido en tu computadora.

> **Importante:** Tu proyecto local original en la carpeta [`WEB/`](../WEB/) se mantiene **100% intacto y funcional**.

---

## 1. ¿Cómo funciona la arquitectura en GitHub Pages?

```
┌────────────────────────────────────────────────────────┐
│             Navegador del Usuario (Cliente)            │
│  (https://tu-usuario.github.io/tu-repo/WEB_github/)   │
└───────────────┬────────────────────────┬───────────────┘
                │                        │
       Petición Directa (CORS OK)        │  Petición GNSS (Requiere Referer)
                ▼                        ▼
┌───────────────────────────────┐ ┌─────────────────────────────────────┐
│  NOAA Space Weather (SWPC)   │ │  Cloudflare Worker Gratuito         │
│  (Pronóstico Kp y Alertas G)  │ │  (cloudflare-worker.js)             │
│  100% En Vivo sin Proxy       │ └──────────────────┬──────────────────┘
└───────────────────────────────┘                    │ Inyecta cabeceras
                                                     ▼
                                  ┌─────────────────────────────────────┐
                                  │  Trimble GNSSPlanning API           │
                                  │  (TEC diurno y Centelleo F-layer)   │
                                  └─────────────────────────────────────┘
```

1. **Pronóstico Kp y Alertas NOAA (G1 a G5):**
   - Se consulta **directamente desde el navegador** a los servidores de NOAA (`services.swpc.noaa.gov`).
   - NOAA incluye por defecto la cabecera `Access-Control-Allow-Origin: *`, por lo que **no requiere ningún backend ni proxy**.
2. **TEC y Centelleo (Trimble GNSSPlanning):**
   - Trimble no permite CORS abierto y exige la cabecera `Referer: https://gnssplanning.com/`. Como los navegadores bloquean estas peticiones por seguridad, se utiliza un micro-proxy serverless en **Cloudflare Workers** (gratuito).
   - **Modo Demostración / Offline:** Si no configuras el worker, la web carga automáticamente un dataset de muestra para Cuajone, permitiendo navegar y utilizar la herramienta de inmediato.

---

## 2. Pasos para Publicar en GitHub Pages

1. **Subir los cambios a GitHub:**
   Asegúrate de que la carpeta `WEB_github` esté subida a tu repositorio de GitHub.
2. **Activar GitHub Pages:**
   - En tu repositorio de GitHub, ve a **Settings** -> **Pages**.
   - En **Build and deployment** > **Source**, selecciona **Deploy from a branch**.
   - Elige tu rama (`main` o `master`) y la carpeta `/` (root) o `/docs` (si copias el contenido de `WEB_github` a la raíz de tu rama `gh-pages` o a `docs/`).
   - Guarda los cambios. En 1 minuto GitHub te dará tu enlace público: `https://tu-usuario.github.io/...`.

---

## 3. Conectar TEC y Centelleo en Vivo (Cloudflare Worker — 2 Minutos)

El archivo [`cloudflare-worker.js`](./cloudflare-worker.js) contiene el código necesario para intermediar las consultas a Trimble sin costo alguno (Cloudflare ofrece 100,000 peticiones gratis al día):

1. Ingresa a [dash.cloudflare.com](https://dash.cloudflare.com/) y crea una cuenta gratuita.
2. En el panel izquierdo, ve a **Workers & Pages** -> **Create Application** -> **Create Worker**.
3. Asígnale el nombre `geo-proxy` y pulsa **Deploy**.
4. Haz clic en **Edit Code**, borra el código por defecto y **pega todo el contenido de [`cloudflare-worker.js`](./cloudflare-worker.js)**.
5. Pulsa **Deploy** (arriba a la derecha).
6. Copia tu URL pública generada (ejemplo: `https://geo-proxy.tunombre.workers.dev`).
7. Abre tu web en GitHub Pages, haz clic en el icono **⚙️ PROXY** de la barra superior, pega la URL y dale a **Guardar proxy**.

¡Listo! A partir de ese momento, tu web en GitHub Pages consultará TEC, Centelleo y Kp en tiempo real para cualquier coordenada del mundo.
