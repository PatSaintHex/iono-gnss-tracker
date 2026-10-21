import { clearReports, deleteSiteReports, listAllReports, listReports, saveReport } from "./storage.js";

const SITE_KEY = "geoionosfera-sites-v1";
const SELECTED_SITE_KEY = "geoionosfera-selected-site-v1";
const WELCOME_DISMISSED_KEY = "geoionosfera-welcome-dismissed-v1";
const GNSS_PROXY_URL = "/api/ionoindex";
const DEFAULT_SITES = [{ id: "cuajone", name: "Cuajone", lat: -17.0315, lon: -70.7263, timezone: "America/Lima" }];
const NOAA_URL = "https://services.swpc.noaa.gov/text/3-day-forecast.txt";
const KP_INTERVALS = ["00-03UT", "03-06UT", "06-09UT", "09-12UT", "12-15UT", "15-18UT", "18-21UT", "21-00UT"];

const elements = Object.fromEntries([
  "connection-status", "site-select", "site-coordinates", "manage-sites", "refresh-button", "install-button",
  "help-button", "welcome-dialog", "close-welcome", "dismiss-welcome", "remember-welcome",
  "report-period", "updated-at", "freshness", "notice", "summary-content", "ionosphere-chart", "chart-empty",
  "kp-body", "kp-date-0", "kp-date-1", "kp-date-2", "storm-badge", "scint-events", "storm-events",
  "history-count", "history-list", "sites-dialog", "site-form", "site-list", "form-legend", "edit-site-id",
  "site-name", "site-lat", "site-lon", "site-timezone", "cancel-edit", "close-sites", "export-data",
  "clear-history"
].map((id) => [id, document.getElementById(id)]));

let sites = loadSites();
let selectedSiteId = localStorage.getItem(SELECTED_SITE_KEY) || sites[0].id;
let activeReport = null;
let installPrompt = null;
let refreshInProgress = false;

function loadSites() {
  try {
    const saved = JSON.parse(localStorage.getItem(SITE_KEY) || "null");
    if (Array.isArray(saved) && saved.length) {
      const validSites = saved.filter(isValidSite);
      if (validSites.length) return validSites;
    }
  } catch { /* Ignore unreadable local preferences. */ }
  return DEFAULT_SITES.map((site) => ({ ...site }));
}

function isValidSite(site) {
  return site && typeof site.id === "string" && typeof site.name === "string"
    && Number.isFinite(Number(site.lat)) && Number.isFinite(Number(site.lon))
    && Number(site.lat) >= -90 && Number(site.lat) <= 90
    && Number(site.lon) >= -180 && Number(site.lon) <= 180
    && typeof site.timezone === "string";
}

function saveSites() {
  localStorage.setItem(SITE_KEY, JSON.stringify(sites));
}

function getSelectedSite() {
  return sites.find((site) => site.id === selectedSiteId) || sites[0];
}

function isoDateInZone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function utcStartOfLocalDate(dateString, timezone) {
  const [year, month, day] = dateString.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  const guess = new Date(target);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(guess);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  const localAtGuess = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
  return new Date(target - (localAtGuess - target)).toISOString().slice(0, 19);
}

function dateLabel(dateString, timezone, options = { day: "2-digit", month: "short" }) {
  const date = new Date(`${dateString}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-PE", { ...options, timeZone: timezone }).format(date);
}

function timeLabel(date, timezone) {
  return new Intl.DateTimeFormat("es-PE", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function showNotice(message, kind = "") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${kind}`.trim();
  elements.notice.hidden = false;
}

function clearNotice() {
  elements.notice.hidden = true;
  elements.notice.textContent = "";
}

function setConnection(state, label) {
  elements["connection-status"].className = `connection-status ${state}`;
  elements["connection-status"].lastElementChild.textContent = label;
}

function renderSites() {
  if (!sites.some((site) => site.id === selectedSiteId)) selectedSiteId = sites[0].id;
  elements["site-select"].innerHTML = sites.map((site) => `<option value="${escapeHtml(site.id)}">${escapeHtml(site.name)}</option>`).join("");
  elements["site-select"].value = selectedSiteId;
  localStorage.setItem(SELECTED_SITE_KEY, selectedSiteId);
  const site = getSelectedSite();
  elements["site-coordinates"].textContent = `${Number(site.lat).toFixed(4)}, ${Number(site.lon).toFixed(4)} · ${site.timezone}`;
}

function parseNoaa(text) {
  const lines = text.split(/\r?\n/);
  const titleLine = lines.find((line) => line.includes("NOAA Kp index breakdown")) || "";
  const titleYear = Number(titleLine.match(/\b(20\d{2})\b/)?.[1]) || new Date().getUTCFullYear();
  const monthNumbers = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const dateLineIndex = lines.findIndex((line) => (line.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/g) || []).length >= 3);
  if (dateLineIndex < 0) throw new Error("No se encontró la cabecera de fechas del pronóstico NOAA.");

  let year = titleYear;
  let previousMonth = 0;
  const dates = (lines[dateLineIndex].match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/g) || []).map((token) => {
    const [, monthName, day] = token.match(/([A-Z][a-z]{2})\s+(\d{1,2})/);
    const month = monthNumbers[monthName];
    if (previousMonth === 12 && month === 1) year += 1;
    previousMonth = month;
    return `${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`;
  });

  const rows = [];
  for (const line of lines.slice(dateLineIndex + 1)) {
    const match = line.match(/^\s*(\d{2})-\d{2}UT\s+(.+)$/);
    if (!match) continue;
    const hour = Number(match[1]);
    const values = Array.from(match[2].matchAll(/(\d+(?:\.\d+)?)(?:\s*\(G([1-5])\))?/g), (valueMatch) => {
      const rawKp = Number(valueMatch[1]);
      const gLevel = Number(valueMatch[2] || 0);
      const kp = gLevel ? Math.max(rawKp, gLevel + 4) : rawKp;
      return { rawKp, kp, gLevel };
    });
    dates.forEach((date, index) => {
      const item = values[index];
      if (item && Number.isFinite(item.kp)) {
        rows.push({
          date,
          hour,
          kp: item.kp,
          rawKp: item.rawKp,
          gLevel: item.gLevel,
          time: new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`)
        });
      }
    });
  }
  if (!rows.length) throw new Error("No se encontraron valores Kp en el TXT de NOAA.");
  return { dates, rows, issued: lines.find((line) => line.startsWith(":Issued:"))?.replace(":Issued:", "").trim() || "" };
}

async function fetchNoaa() {
  const response = await fetch(NOAA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`NOAA respondió HTTP ${response.status}.`);
  return parseNoaa(await response.text());
}

async function fetchGnssDay(site, date) {
  const parameters = new URLSearchParams({
    lat: String(site.lat), lon: String(site.lon), start: utcStartOfLocalDate(date, site.timezone), hours: "24", interval: "600"
  });
  const response = await fetch(`${GNSS_PROXY_URL}?${parameters}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Servicio GNSS respondió HTTP ${response.status}.`);
  if (!Array.isArray(payload)) throw new Error("GNSSPlanning devolvió un formato no esperado.");
  return payload;
}

function flattenGnss(gnssByDate) {
  return Object.values(gnssByDate).flat().filter((row) => row && row.timeOfEstimation).map((row) => ({
    ...row,
    time: new Date(row.timeOfEstimation),
  })).filter((row) => !Number.isNaN(row.time.valueOf())).sort((left, right) => left.time - right.time);
}

function localDateRows(rows, start, end, timezone) {
  return rows.filter((row) => {
    const localDate = isoDateInZone(row.time, timezone);
    return localDate >= start && localDate <= end;
  });
}

function detectEvents(rows, valueKey, threshold, timezone, gapMinutes = 25, durationMinutes = 10) {
  const selected = rows.filter((row) => Number.isFinite(Number(row[valueKey])) && Number(row[valueKey]) > threshold && row[valueKey] !== null).sort((a, b) => a.time - b.time);
  const events = [];
  for (const row of selected) {
    const value = Number(row[valueKey]);
    const current = events.at(-1);
    if (current && (row.time - current.lastTime) / 60000 <= gapMinutes) {
      current.lastTime = row.time;
      current.end = new Date(row.time.valueOf() + durationMinutes * 60000);
      current.max = Math.max(current.max, value);
    } else {
      events.push({ start: row.time, lastTime: row.time, end: new Date(row.time.valueOf() + durationMinutes * 60000), max: value });
    }
  }
  return events.map((event) => ({ ...event, startText: `${dateLabel(isoDateInZone(event.start, timezone), timezone, { day: "2-digit", month: "short" })} ${timeLabel(event.start, timezone)}`, endText: timeLabel(event.end, timezone) }));
}

function kpEvents(rows) {
  return detectEvents(rows.map((row) => ({ ...row, value: row.kp })), "value", 4.99, "UTC", 190, 180);
}

function summarize(report) {
  const gnssRows = flattenGnss(report.gnssByDate);
  const visibleGnss = localDateRows(gnssRows, report.rangeStart, report.rangeEnd, report.site.timezone);
  const scintEvents = detectEvents(visibleGnss, "scintiValue", 1, report.site.timezone, 25, 10);
  const storms = kpEvents(report.noaa.rows).filter((event) => {
    const localDate = isoDateInZone(event.start, report.site.timezone);
    return localDate >= report.rangeStart && localDate <= report.rangeEnd;
  });
  const coincident = scintEvents.some((scint) => storms.some((storm) => scint.start < storm.end && scint.end > storm.start));
  const predictedRows = visibleGnss.filter((row) => row.predicted === true).length;
  let conclusion = "Actividad ionosférica estable en los umbrales seleccionados.";
  if (storms.length && scintEvents.length && coincident) conclusion = "Se observan intervalos de centelleo que coinciden temporalmente con Kp de tormenta. La coincidencia no demuestra causalidad.";
  else if (storms.length && scintEvents.length) conclusion = "Se observaron eventos geomagnéticos y de centelleo en intervalos diferentes.";
  else if (storms.length) conclusion = "Hay intervalos de pronóstico geomagnético Kp ≥ 5; no se detectó centelleo significativo coincidente en los datos disponibles.";
  else if (scintEvents.length) conclusion = "Se detectaron intervalos de centelleo > 1 sin alerta geomagnética Kp ≥ 5 en el período.";
  return { gnssRows: visibleGnss, scintEvents, storms, predictedRows, conclusion };
}

function localKpRows(report) {
  return localDateRows(report.noaa.rows, report.rangeStart, report.rangeEnd, report.site.timezone);
}

function renderReport(report, stale = false) {
  activeReport = report;
  const site = report.site;
  const result = summarize(report);
  elements["site-coordinates"].textContent = `${Number(site.lat).toFixed(4)}, ${Number(site.lon).toFixed(4)} · ${site.timezone}`;
  elements["report-period"].textContent = `${dateLabel(report.rangeStart, site.timezone)} — ${dateLabel(report.rangeEnd, site.timezone)}`;
  elements["updated-at"].textContent = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.savedAt));
  elements.freshness.textContent = stale ? "COPIA LOCAL" : "ACTUALIZADO";
  elements.freshness.className = `freshness${stale ? " stale" : ""}`;
  elements["storm-badge"].textContent = result.storms.length ? `${result.storms.length} intervalo${result.storms.length === 1 ? "" : "s"} G` : "Sin alerta G";
  elements["storm-badge"].className = `storm-badge${result.storms.length ? " alert" : ""}`;

  elements["summary-content"].innerHTML = `
    <article class="summary-item ${result.storms.length ? "alert" : ""}"><h3>Actividad geomagnética</h3><strong>${result.storms.length ? `G${Math.max(...result.storms.map((event) => Math.max(1, Math.min(5, Math.floor(event.max) - 4))))} · Kp ≥ 5` : "Kp < 5"}</strong><p>${result.storms.length ? `${result.storms.length} intervalo(s) en el período` : "Sin alerta NOAA G detectada"}</p></article>
    <article class="summary-item ${result.scintEvents.length ? "warn" : ""}"><h3>Centelleo significativo</h3><strong>${result.scintEvents.length ? `${result.scintEvents.length} evento(s)` : "Sin eventos"}</strong><p>${result.scintEvents.length ? `Máximo ${Math.max(...result.scintEvents.map((event) => event.max)).toFixed(2)}` : "Umbral de observación: > 1"}</p></article>
    <article class="summary-item"><h3>Datos GNSS</h3><strong>${result.gnssRows.length} muestras</strong><p>${result.predictedRows ? `${result.predictedRows} estimadas` : "Muestras del período"}</p></article>
    <p class="conclusion"><strong>Conclusión:</strong> ${escapeHtml(result.conclusion)}</p>`;

  renderKp(report);
  renderEvents(elements["scint-events"], result.scintEvents, "max");
  renderEvents(elements["storm-events"], result.storms, "max");
  drawChart(report, result.gnssRows);
}

export function getKpScale(kp, gLevel = 0) {
  const numericKp = Number(kp) || 0;
  const effectiveG = Number(gLevel) || (numericKp >= 9 ? 5 : numericKp >= 8 ? 4 : numericKp >= 7 ? 3 : numericKp >= 6 ? 2 : numericKp >= 5 ? 1 : 0);

  if (effectiveG >= 5) {
    return {
      level: 5,
      g: "G5",
      label: "Kp = 9o (G5)",
      bg: "#c80000",
      fill: "#c80000",
      text: "#111111",
      canvasText: "#ffffff",
      border: "#8b0000"
    };
  }
  if (effectiveG === 4) {
    return {
      level: 4,
      g: "G4",
      label: "Kp = 8, 9- (G4)",
      bg: "#ff0000",
      fill: "#ff0000",
      text: "#111111",
      canvasText: "#ffffff",
      border: "#b80000"
    };
  }
  if (effectiveG === 3) {
    return {
      level: 3,
      g: "G3",
      label: "Kp = 7 (G3)",
      bg: "#ff9600",
      fill: "#ff9600",
      text: "#111111",
      canvasText: "#18323b",
      border: "#cc7700"
    };
  }
  if (effectiveG === 2) {
    return {
      level: 2,
      g: "G2",
      label: "Kp = 6 (G2)",
      bg: "#ffc800",
      fill: "#ffc800",
      text: "#111111",
      canvasText: "#18323b",
      border: "#cca000"
    };
  }
  if (effectiveG === 1) {
    return {
      level: 1,
      g: "G1",
      label: "Kp = 5 (G1)",
      bg: "#f6eb14",
      fill: "#f6eb14",
      text: "#111111",
      canvasText: "#18323b",
      border: "#c4ba0f"
    };
  }
  return {
    level: 0,
    g: "",
    label: "Kp < 5",
    bg: "#92d050",
    fill: "#92d050",
    text: "#111111",
    canvasText: "#18323b",
    border: "#72a73a"
  };
}

function renderKp(report) {
  const dates = report.noaa.dates.slice(0, 3);
  dates.forEach((date, index) => { elements[`kp-date-${index}`].textContent = dateLabel(date, "UTC"); });
  const lookup = new Map(report.noaa.rows.map((row) => [`${row.date}:${row.hour}`, row]));
  elements["kp-body"].innerHTML = KP_INTERVALS.map((interval, index) => {
    const hour = index * 3;
    const values = dates.map((date) => {
      const row = lookup.get(`${date}:${hour}`);
      if (!row || !Number.isFinite(row.kp)) return `<td class="kp-cell empty-cell">—</td>`;
      const scale = getKpScale(row.kp, row.gLevel);
      return `<td class="kp-cell">
        <span class="kp-pill" style="background-color: ${scale.bg}; color: ${scale.text}; border: 1px solid ${scale.border};">
          ${row.kp.toFixed(2)}${scale.g ? ` <small class="g-tag">${scale.g}</small>` : ""}
        </span>
      </td>`;
    }).join("");
    return `<tr><td>${interval}</td>${values}</tr>`;
  }).join("");
}

function renderEvents(list, events, valueLabel) {
  if (!events.length) {
    list.innerHTML = '<li class="empty-state">No se detectaron eventos sobre el umbral.</li>';
    return;
  }
  list.innerHTML = events.slice(0, 12).map((event) => `<li><span>${escapeHtml(event.startText)}–${escapeHtml(event.endText)}</span><span>${escapeHtml(Number(event[valueLabel]).toFixed(2))}</span></li>`).join("");
}

function drawChart(report, rows) {
  const canvas = elements["ionosphere-chart"];
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  const noaaDates = report.noaa?.dates || [];
  const noaaRows = report.noaa?.rows || [];
  const chartStart = noaaDates.length ? Date.parse(`${noaaDates[0]}T00:00:00Z`) : rows?.[0]?.time?.valueOf();
  const chartEnd = noaaDates.length ? Date.parse(`${shiftDate(noaaDates.at(-1), 1)}T00:00:00Z`) : rows?.at(-1)?.time?.valueOf();

  const valid = (rows || []).filter((row) => row && row.time
    && row.time.valueOf() >= chartStart && row.time.valueOf() <= chartEnd
    && (Number.isFinite(Number(row.tecValue)) || Number.isFinite(Number(row.scintiValue))));

  const hasData = noaaRows.length > 0 || valid.length > 0;
  elements["chart-empty"].hidden = hasData;
  canvas.dataset.kpIntervals = String(noaaRows.length);
  if (!hasData || !Number.isFinite(chartStart) || !Number.isFinite(chartEnd)) return;

  const width = rect.width;
  const height = rect.height;
  const margin = { top: 24, right: 64, bottom: 38, left: 46 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const minTime = chartStart;
  const maxTime = chartEnd;
  const x = (date) => margin.left + ((date.valueOf() - minTime) / Math.max(1, maxTime - minTime)) * plotWidth;

  // Escala dinámica Y izquierda para proteger contra desbordes en tormentas ionosféricas severas
  const maxObservedTec = Math.max(0, ...valid.map((r) => Number(r.tecValue) || 0));
  const maxObservedScint = Math.max(0, ...valid.map((r) => Number(r.scintiValue) || 0));
  const maxLeftY = Math.max(100, Math.ceil(Math.max(maxObservedTec, maxObservedScint) / 20) * 20);

  const y = (value) => margin.top + plotHeight - (Math.max(0, Math.min(maxLeftY, value)) / maxLeftY) * plotHeight;
  const kpHeight = (value) => (Math.max(0, Math.min(9, value)) / 9) * plotHeight;

  // 1. Grid horizontal de referencia (0 a maxLeftY para TEC y Centelleo)
  context.font = "10px DM Sans, sans-serif";
  context.textBaseline = "middle";
  context.strokeStyle = "#e8ecea";
  context.fillStyle = "#748589";
  context.lineWidth = 1;
  for (let tick = 0; tick <= maxLeftY; tick += 20) {
    const py = y(tick);
    context.beginPath();
    context.moveTo(margin.left, py);
    context.lineTo(width - margin.right, py);
    context.stroke();
    context.textAlign = "right";
    context.fillText(String(tick), margin.left - 8, py);
  }

  // Título eje izquierdo: Unidades claras de observación ionosférica
  context.fillStyle = "#197a8c";
  context.font = "bold 9px Segoe UI, sans-serif";
  context.textAlign = "left";
  context.fillText("TEC (TECU) · Centelleo (%)", margin.left - 4, margin.top - 9);

  // Línea guía Kp 5 (Umbral Tormenta G1)
  const pyKp5 = margin.top + plotHeight - kpHeight(5);
  context.save();
  context.beginPath();
  context.setLineDash([4, 4]);
  context.strokeStyle = "rgba(217, 139, 0, 0.60)";
  context.lineWidth = 1.2;
  context.moveTo(margin.left, pyKp5);
  context.lineTo(width - margin.right, pyKp5);
  context.stroke();
  context.fillStyle = "#a86800";
  context.font = "bold 9px Segoe UI, sans-serif";
  context.textAlign = "right";
  context.fillText("Umbral Tormenta G1 (Kp ≥ 5)", width - margin.right - 8, pyKp5 - 4);
  context.restore();

  // 2. Separadores verticales de días (medianoche UTC)
  if (noaaDates.length > 1) {
    context.save();
    context.setLineDash([2, 4]);
    context.strokeStyle = "#cbd5d0";
    context.lineWidth = 1;
    for (let i = 1; i < noaaDates.length; i++) {
      const dateX = Math.round(x(new Date(`${noaaDates[i]}T00:00:00Z`)));
      context.beginPath();
      context.moveTo(dateX, margin.top);
      context.lineTo(dateX, margin.top + plotHeight);
      context.stroke();
    }
    context.restore();
  }

  // 3. Dibujar Columnas Kp con colores NOAA
  const barIntervalMs = 3 * 3600 * 1000;
  for (const row of noaaRows) {
    const xStart = x(row.time);
    const xEnd = x(new Date(row.time.valueOf() + barIntervalMs));
    if (xEnd < margin.left || xStart > width - margin.right) continue;

    const clampedXStart = Math.max(margin.left, xStart);
    const clampedXEnd = Math.min(width - margin.right, xEnd);
    const rawWidth = clampedXEnd - clampedXStart;
    const barWidth = Math.max(2, rawWidth - 1.5);
    const barX = clampedXStart + 0.75;

    const barHeight = Math.max(2, kpHeight(row.kp));
    const barTop = margin.top + plotHeight - barHeight;
    const scale = getKpScale(row.kp, row.gLevel);

    // Relleno de la columna (con transparencia para destacar curvas en primer plano)
    context.save();
    context.globalAlpha = 0.72;
    context.fillStyle = scale.fill;
    context.fillRect(barX, barTop, barWidth, barHeight);
    context.restore();

    // Borde de la columna
    context.strokeStyle = "rgba(0, 0, 0, 0.28)";
    context.lineWidth = 1;
    context.strokeRect(barX, barTop, barWidth, barHeight);

    // Valor numérico de Kp
    if (barWidth >= 13) {
      if (barHeight >= 16) {
        context.fillStyle = scale.canvasText;
        context.font = `600 ${Math.max(8, Math.min(11, barWidth * 0.32))}px Segoe UI, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(row.kp.toFixed(1), barX + barWidth / 2, barTop + barHeight / 2);
      } else {
        context.fillStyle = "#334448";
        context.font = "600 9px Segoe UI, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "bottom";
        context.fillText(row.kp.toFixed(1), barX + barWidth / 2, barTop - 1);
      }
    }

    // Alerta G sobre la barra si Kp >= 5
    if (row.kp >= 5 || scale.g) {
      context.save();
      context.fillStyle = scale.level >= 4 ? "#b30000" : "#a66800";
      context.font = "bold 11px Segoe UI, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "bottom";
      const gY = barHeight >= 16 ? barTop - 2 : barTop - 11;
      context.fillText(scale.g, barX + barWidth / 2, Math.max(margin.top + 9, gY));
      context.restore();
    }
  }

  // 4. Eje derecho (Escala Kp y Alertas NOAA G1 a G5)
  context.strokeStyle = "#8f7b53";
  context.fillStyle = "#635028";
  context.lineWidth = 1;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.font = "10px DM Sans, sans-serif";
  const rightTicks = [
    { v: 0, label: "0" },
    { v: 3, label: "3" },
    { v: 5, label: "5 (G1)" },
    { v: 6, label: "6 (G2)" },
    { v: 7, label: "7 (G3)" },
    { v: 8, label: "8 (G4)" },
    { v: 9, label: "9 (G5)" }
  ];
  for (const tick of rightTicks) {
    const py = margin.top + plotHeight - kpHeight(tick.v);
    context.beginPath();
    context.moveTo(width - margin.right, py);
    context.lineTo(width - margin.right + 4, py);
    context.stroke();
    if (tick.v >= 5) {
      context.save();
      context.fillStyle = tick.v >= 8 ? "#b30000" : "#a86800";
      context.font = "bold 9.5px Segoe UI, sans-serif";
      context.fillText(tick.label, width - margin.right + 7, py);
      context.restore();
    } else {
      context.fillText(tick.label, width - margin.right + 7, py);
    }
  }
  // Título eje derecho: anclado al margen derecho para crecer hacia la izquierda sin recortarse
  context.fillStyle = "#635028";
  context.font = "bold 9px Segoe UI, sans-serif";
  context.textAlign = "right";
  context.fillText("Kp · Alerta G", width - 8, margin.top - 9);

  // 5. Curvas GNSS (TEC y Centelleo, dibujadas SOBRE las columnas)
  if (valid.length > 0) {
    // Sombreado bajo la curva de TEC para darle cuerpo y contraste
    context.save();
    context.beginPath();
    let firstPoint = null;
    let lastPoint = null;
    for (const row of valid) {
      const val = Number(row.tecValue);
      if (!Number.isFinite(val) || row.tecValue === null) continue;
      const px = x(row.time);
      const py = y(val);
      if (!firstPoint) { firstPoint = { x: px, y: py }; context.moveTo(px, py); }
      else context.lineTo(px, py);
      lastPoint = { x: px, y: py };
    }
    if (firstPoint && lastPoint) {
      const basePy = y(0);
      context.lineTo(lastPoint.x, basePy);
      context.lineTo(firstPoint.x, basePy);
      context.closePath();
      context.fillStyle = "rgba(25, 122, 140, 0.10)";
      context.fill();
    }
    context.restore();

    // Trazo de líneas principales
    const drawSeries = (field, color, dashed, widthPx) => {
      context.beginPath();
      context.strokeStyle = color;
      context.lineWidth = widthPx;
      context.setLineDash(dashed ? [5, 4] : []);
      let started = false;
      for (const row of valid) {
        const value = Number(row[field]);
        if (!Number.isFinite(value) || row[field] === null) { started = false; continue; }
        if (!started) { context.moveTo(x(row.time), y(value)); started = true; }
        else context.lineTo(x(row.time), y(value));
      }
      context.stroke();
      context.setLineDash([]);
    };
    drawSeries("tecValue", "#197a8c", false, 2.4);
    drawSeries("scintiValue", "#bf4b3c", true, 2.4);

    // Destacar picos de centelleo significativo (> 1) con puntos de alerta
    context.save();
    context.fillStyle = "#bf4b3c";
    for (const row of valid) {
      const scint = Number(row.scintiValue);
      if (Number.isFinite(scint) && scint > 1) {
        context.beginPath();
        context.arc(x(row.time), y(scint), 2.5, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }

  // 6. Etiquetas de tiempo inferiores (hora local del sitio)
  const labelCount = Math.min(6, Math.max(2, Math.floor(plotWidth / 110)));
  context.textAlign = "center";
  context.font = "10px DM Sans, sans-serif";
  for (let index = 0; index <= labelCount; index += 1) {
    const at = new Date(minTime + ((maxTime - minTime) * index) / labelCount);
    const px = x(at);
    context.fillStyle = "#748589";
    context.fillText(`${dateLabel(isoDateInZone(at, report.site.timezone), report.site.timezone)} ${timeLabel(at, report.site.timezone)}`, px, height - 15);
  }
}

async function refreshReport() {
  if (refreshInProgress || !sites.length) return;
  refreshInProgress = true;
  elements["refresh-button"].disabled = true;
  clearNotice();
  const site = { ...getSelectedSite() };
  const today = isoDateInZone(new Date(), site.timezone);
  const rangeStart = shiftDate(today, -1);
  const rangeEnd = shiftDate(today, 1);
  const dates = [rangeStart, today, rangeEnd];
  const id = `${site.id}:${rangeStart}:${rangeEnd}`;
  const cached = await listReports(site.id, 1).catch(() => []);
  if (cached.length) renderReport(cached[0], true);
  setConnection("", "Actualizando");

  try {
    const [noaa, dayResults] = await Promise.all([
      fetchNoaa(),
      Promise.all(dates.map(async (date) => {
        try { return [date, await fetchGnssDay(site, date), null]; }
        catch (error) { return [date, null, error]; }
      }))
    ]);
    const gnssByDate = Object.fromEntries(dayResults.map(([date, data, error]) => [
      date,
      data || cached[0]?.gnssByDate?.[date] || []
    ]));
    const failedDays = dayResults.filter(([, data]) => !data).length;
    const report = { id, siteId: site.id, site, rangeStart, rangeEnd, savedAt: new Date().toISOString(), noaa, gnssByDate };
    renderReport(report);
    await saveReport(report);
    await renderHistory(site.id);
    setConnection(failedDays ? "offline" : "online", failedDays ? "Datos parciales" : "En línea");
    if (failedDays) showNotice("No se actualizaron todos los días de GNSSPlanning. Se muestran datos guardados cuando estaban disponibles.", "error");
    else showNotice("Pronóstico NOAA y datos GNSS actualizados.", "success");
  } catch (error) {
    setConnection("offline", navigator.onLine ? "Fuente no disponible" : "Sin conexión");
    if (cached.length) {
      renderReport(cached[0], true);
      showNotice(`No se pudo actualizar. Se conserva el último informe local. ${error.message}`, "error");
    } else {
      elements["summary-content"].innerHTML = '<p class="empty-state">No hay consulta guardada. Conéctate para cargar el primer reporte.</p>';
      showNotice(`No se pudieron obtener los datos: ${error.message}`, "error");
    }
  } finally {
    refreshInProgress = false;
    elements["refresh-button"].disabled = false;
  }
}

async function renderHistory(siteId) {
  const reports = await listReports(siteId, 12).catch(() => []);
  elements["history-count"].textContent = String(reports.length);
  if (!reports.length) {
    elements["history-list"].innerHTML = '<p class="empty-state">Todavía no hay consultas guardadas en este navegador.</p>';
    return;
  }
  elements["history-list"].innerHTML = reports.map((report) => `<button class="history-entry" type="button" data-report-id="${escapeHtml(report.id)}"><span><strong>${escapeHtml(report.site.name)}</strong><span>${escapeHtml(dateLabel(report.rangeStart, report.site.timezone))} — ${escapeHtml(dateLabel(report.rangeEnd, report.site.timezone))}</span></span><span>${escapeHtml(new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit" }).format(new Date(report.savedAt)))}</span></button>`).join("");
  elements["history-list"].querySelectorAll("[data-report-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const all = await listReports(siteId, 60);
      const report = all.find((item) => item.id === button.dataset.reportId);
      if (report) { renderReport(report, true); showNotice("Mostrando la copia local guardada en este dispositivo."); }
    });
  });
}

function renderSiteList() {
  elements["site-list"].innerHTML = sites.map((site) => `<div class="site-row"><div><strong>${escapeHtml(site.name)}</strong><small>${Number(site.lat).toFixed(4)}, ${Number(site.lon).toFixed(4)} · ${escapeHtml(site.timezone)}</small></div><div class="site-row-actions"><button type="button" data-edit="${escapeHtml(site.id)}">Editar</button><button type="button" data-delete="${escapeHtml(site.id)}">Eliminar</button></div></div>`).join("");
  elements["site-list"].querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => editSite(button.dataset.edit)));
  elements["site-list"].querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => removeSite(button.dataset.delete)));
}

function editSite(id) {
  const site = sites.find((item) => item.id === id);
  if (!site) return;
  elements["edit-site-id"].value = site.id;
  elements["site-name"].value = site.name;
  elements["site-lat"].value = site.lat;
  elements["site-lon"].value = site.lon;
  elements["site-timezone"].value = site.timezone;
  elements["form-legend"].textContent = "Editar ubicación";
  elements["cancel-edit"].hidden = false;
  elements["site-name"].focus();
}

function resetSiteForm() {
  elements["site-form"].reset();
  elements["edit-site-id"].value = "";
  elements["site-timezone"].value = "America/Lima";
  elements["form-legend"].textContent = "Agregar ubicación";
  elements["cancel-edit"].hidden = true;
}

async function removeSite(id) {
  if (sites.length < 2) { showNotice("Debe quedar al menos una ubicación configurada.", "error"); return; }
  if (!window.confirm("¿Eliminar esta ubicación y sus consultas guardadas en este dispositivo?")) return;
  sites = sites.filter((site) => site.id !== id);
  saveSites();
  if (selectedSiteId === id) selectedSiteId = sites[0].id;
  localStorage.setItem(SELECTED_SITE_KEY, selectedSiteId);
  await deleteSiteReports(id).catch(() => {});
  renderSites(); renderSiteList(); await renderHistory(selectedSiteId);
}

function exportLocalData() {
  Promise.all([listAllReports(), Promise.resolve(sites)]).then(([reports, siteData]) => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), sites: siteData, reports }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "geoionosfera-datos-locales.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }).catch(() => showNotice("No se pudo exportar el historial local.", "error"));
}

function wireEvents() {
  elements["site-select"].addEventListener("change", async () => {
    selectedSiteId = elements["site-select"].value;
    renderSites();
    await renderHistory(selectedSiteId);
    refreshReport();
  });
  elements["refresh-button"].addEventListener("click", refreshReport);
  elements["manage-sites"].addEventListener("click", () => { renderSiteList(); elements["sites-dialog"].showModal(); });
  elements["close-sites"].addEventListener("click", () => elements["sites-dialog"].close());
  elements["cancel-edit"].addEventListener("click", resetSiteForm);
  elements["site-form"].addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!elements["site-form"].reportValidity()) return;
    const editId = elements["edit-site-id"].value;
    const site = { id: editId || `site-${crypto.randomUUID()}`, name: elements["site-name"].value.trim(), lat: Number(elements["site-lat"].value), lon: Number(elements["site-lon"].value), timezone: elements["site-timezone"].value.trim() };
    try { new Intl.DateTimeFormat("en", { timeZone: site.timezone }); } catch { showNotice("Ingresa una zona horaria IANA válida, por ejemplo America/Lima.", "error"); return; }
    if (editId) sites = sites.map((item) => item.id === editId ? site : item);
    else sites.push(site);
    saveSites(); selectedSiteId = site.id; localStorage.setItem(SELECTED_SITE_KEY, selectedSiteId);
    renderSites(); renderSiteList(); resetSiteForm(); await renderHistory(selectedSiteId); refreshReport();
  });
  elements["export-data"].addEventListener("click", exportLocalData);
  elements["clear-history"].addEventListener("click", async () => {
    if (!window.confirm("¿Borrar todas las consultas guardadas en este navegador?")) return;
    await clearReports(); await renderHistory(selectedSiteId); showNotice("Consultas locales eliminadas.", "success");
  });
  window.addEventListener("resize", () => { if (activeReport) drawChart(activeReport, summarize(activeReport).gnssRows); });
  window.addEventListener("online", () => { setConnection("online", "En línea"); });
  window.addEventListener("offline", () => { setConnection("offline", "Sin conexión"); });

  const closeWelcome = () => {
    if (elements["remember-welcome"]?.checked) {
      localStorage.setItem(WELCOME_DISMISSED_KEY, "true");
    } else {
      localStorage.removeItem(WELCOME_DISMISSED_KEY);
    }
    elements["welcome-dialog"]?.close();
  };

  elements["help-button"]?.addEventListener("click", () => {
    elements["welcome-dialog"]?.showModal();
  });
  elements["close-welcome"]?.addEventListener("click", closeWelcome);
  elements["dismiss-welcome"]?.addEventListener("click", closeWelcome);
  elements["welcome-dialog"]?.addEventListener("click", (event) => {
    if (event.target === elements["welcome-dialog"]) closeWelcome();
  });
}

function setupInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); installPrompt = event; elements["install-button"].hidden = false;
  });
  elements["install-button"].addEventListener("click", async () => {
    if (!installPrompt) { showNotice("En iPhone o iPad, usa Compartir en Safari y elige Agregar a pantalla de inicio."); return; }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    elements["install-button"].hidden = true;
  });
  const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isAppleMobile && !window.matchMedia("(display-mode: standalone)").matches) {
    elements["install-button"].hidden = false;
  }
  if ("serviceWorker" in navigator && ["https:", "http:"].includes(location.protocol)) {
    navigator.serviceWorker.register(new URL("./service-worker.js", import.meta.url)).catch(() => {});
  }
}

async function initialize() {
  renderSites(); wireEvents(); setupInstall();
  await renderHistory(selectedSiteId);
  if (!("indexedDB" in window)) showNotice("Este navegador no permite almacenamiento local. El historial no estará disponible.", "error");

  const welcomeDismissed = localStorage.getItem(WELCOME_DISMISSED_KEY) === "true";
  if (elements["remember-welcome"]) elements["remember-welcome"].checked = welcomeDismissed;
  if (!welcomeDismissed && elements["welcome-dialog"]) {
    elements["welcome-dialog"].showModal();
  }

  refreshReport();
}

initialize();