// src/utils/resourceMonitor.js
// Monitorización de recursos del servidor (CPU y memoria).
// Expone utilidades para consultar el estado actual y decide si el sistema
// tiene suficiente capacidad para lanzar procesos pesados (Playwright).

const os   = require('os');
const fs   = require('fs');
const path = require('path');

const CPU_SAMPLE_MS      = Number(process.env.RESOURCE_CPU_SAMPLE_MS    || 500);
const CPU_THRESHOLD_PCT  = Number(process.env.RESOURCE_CPU_MAX_PCT       || 80);  // no lanzar si CPU > X%
const MEM_THRESHOLD_MB   = Number(process.env.RESOURCE_MEM_MIN_FREE_MB   || 300); // no lanzar si libre < X MB
const LOG_INTERVAL_MS    = Number(process.env.RESOURCE_LOG_INTERVAL_MIN  || 10) * 60_000;
const LOG_DIR            = path.resolve(__dirname, '../../logs');
const LOG_FILE           = path.join(LOG_DIR, 'resources.log');

let _lastStats = null;
let _monitorTimer = null;

// ── CPU ──────────────────────────────────────────────────────────────────────

/**
 * Devuelve el porcentaje de uso medio de CPU muestreando durante `ms` ms.
 * @returns {Promise<number>}
 */
function sampleCpu(ms = CPU_SAMPLE_MS) {
  return new Promise(resolve => {
    const before = os.cpus().map(c => ({ ...c.times }));
    setTimeout(() => {
      const after = os.cpus().map(c => ({ ...c.times }));
      const percents = before.map((b, i) => {
        const a = after[i];
        const idle  = a.idle  - b.idle;
        const total = Object.keys(a).reduce((sum, k) => sum + (a[k] - b[k]), 0);
        return total > 0 ? 100 * (1 - idle / total) : 0;
      });
      const avg = percents.reduce((a, b) => a + b, 0) / percents.length;
      resolve(Math.round(avg * 10) / 10);
    }, ms);
  });
}

// ── Memoria ───────────────────────────────────────────────────────────────────

function getMemStats() {
  const totalMB = Math.round(os.totalmem() / 1048576);
  const freeMB  = Math.round(os.freemem()  / 1048576);
  return {
    totalMB,
    freeMB,
    usedMB:      totalMB - freeMB,
    freePercent: Math.round((freeMB / totalMB) * 100),
  };
}

// ── Estado combinado ──────────────────────────────────────────────────────────

/**
 * Muestra y almacena las estadísticas actuales.
 * @returns {Promise<{cpuPct, mem, ts, available}>}
 */
async function collectStats() {
  const [cpuPct, mem] = await Promise.all([sampleCpu(), Promise.resolve(getMemStats())]);
  const available = cpuPct < CPU_THRESHOLD_PCT && mem.freeMB >= MEM_THRESHOLD_MB;
  _lastStats = { cpuPct, mem, ts: Date.now(), available };
  return _lastStats;
}

/** Última muestra sin esperar (puede ser null si aún no se ha muestreado). */
function getLastStats() { return _lastStats; }

/**
 * Comprueba si hay recursos suficientes para lanzar un proceso Playwright.
 * Hace una muestra nueva si la última tiene más de 30 s.
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  const stale = !_lastStats || Date.now() - _lastStats.ts > 30_000;
  const stats = stale ? await collectStats() : _lastStats;
  return stats.available;
}

// ── Logging ───────────────────────────────────────────────────────────────────

function _appendLog(line) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* nunca interrumpir flujo principal */ }
}

/**
 * Loguea las estadísticas actuales a consola y al archivo resources.log.
 * @param {string} [context] — etiqueta opcional (p.ej. "before_spawn")
 * @returns {Promise<object>} stats
 */
async function logStats(context = '') {
  const { cpuPct, mem, available } = await collectStats();
  const tag    = context ? ` [${context}]` : '';
  const status = available ? '✅' : '⚠️ ';
  const line   = `${new Date().toISOString()}${tag} | CPU: ${cpuPct}% | RAM libre: ${mem.freeMB} MB / ${mem.totalMB} MB (${mem.freePercent}%) | Recursos: ${available ? 'OK' : 'SATURADOS'}`;
  console.log(`${status} [RECURSOS]${tag} CPU ${cpuPct}% | RAM libre ${mem.freeMB}/${mem.totalMB} MB`);
  _appendLog(line);
  return { cpuPct, mem, available };
}

/**
 * Inicia el ciclo periódico de logging de recursos.
 * Llama a `logStats()` cada LOG_INTERVAL_MS ms.
 */
function startMonitoring() {
  if (_monitorTimer) return; // ya iniciado
  // Primera muestra inmediata (diferida 2 s para no bloquear el arranque)
  setTimeout(() => logStats('startup'), 2000);
  _monitorTimer = setInterval(() => logStats('periodic'), LOG_INTERVAL_MS);
  if (_monitorTimer.unref) _monitorTimer.unref();
  console.log(`📊 Monitor de recursos iniciado (intervalo: ${LOG_INTERVAL_MS / 60_000} min, log: logs/resources.log)`);
}

module.exports = {
  sampleCpu,
  getMemStats,
  collectStats,
  getLastStats,
  isAvailable,
  logStats,
  startMonitoring,
  CPU_THRESHOLD_PCT,
  MEM_THRESHOLD_MB,
};
