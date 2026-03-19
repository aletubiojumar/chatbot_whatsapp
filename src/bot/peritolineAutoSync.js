// src/bot/peritolineAutoSync.js
// Disparador asíncrono para sincronizar un encargo en PeritoLine.
//
// Garantías:
//  · Máximo MAX_CONCURRENT instancias de Playwright simultáneas (evita saturación de recursos).
//  · Cola persistente de reintentos para syncs que fallan por recursos.
//  · Deduplicación: un isFinalSync siempre reemplaza a un assignOnly pendiente del mismo encargo.
//  · No se producen comunicaciones duplicadas con el asegurado: los mensajes WhatsApp se envían
//    ANTES de llamar a este módulo; los reintentos solo tocan PeritoLine.

const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');
const log = require('../utils/logger');
const fileLogger = require('../utils/fileLogger');
const resourceMonitor = require('../utils/resourceMonitor');

// ── Configuración ─────────────────────────────────────────────────────────────

const AUTO_SYNC_ENABLED    = !/^(0|false|no)$/i.test(String(process.env.PERITOLINE_AUTO_SYNC || 'true'));
const AUTO_SYNC_COOLDOWN_MS = Number(process.env.PERITOLINE_AUTO_SYNC_COOLDOWN_MS || 45_000);
const MAX_CONCURRENT        = Number(process.env.PERITOLINE_MAX_CONCURRENT        || 2);
const MAX_RETRY_ATTEMPTS    = Number(process.env.PERITOLINE_MAX_RETRY_ATTEMPTS    || 5);
const RETRY_CHECK_MS        = Number(process.env.PERITOLINE_RETRY_CHECK_MIN       || 5) * 60_000;
const RETRY_QUEUE_PATH      = path.resolve(__dirname, '../../data/sync_retry_queue.json');

// Backoff en minutos por número de intento (1-based)
const RETRY_BACKOFF_MIN = [0, 5, 15, 30, 60, 120];

// ── Estado en memoria ─────────────────────────────────────────────────────────

const running          = new Set();          // encargos con Playwright activo
const lastRunByEncargo = new Map();          // encargo → timestamp último spawn
const pendingFinal     = new Map();          // encargo → { anotacion } para final-sync encolado
let   runningCount     = 0;                  // total de instancias Playwright activas
const globalQueue      = [];                 // cola global por límite de concurrencia

// ── Cola persistente de reintentos ────────────────────────────────────────────

function _loadRetryQueue() {
  try {
    if (fs.existsSync(RETRY_QUEUE_PATH)) {
      return JSON.parse(fs.readFileSync(RETRY_QUEUE_PATH, 'utf8')) || [];
    }
  } catch (e) {
    log.error('❌ Error leyendo cola de reintentos:', e.message);
  }
  return [];
}

function _saveRetryQueue(queue) {
  try {
    fs.writeFileSync(RETRY_QUEUE_PATH, JSON.stringify(queue, null, 2));
  } catch (e) {
    log.error('❌ Error guardando cola de reintentos:', e.message);
  }
}

/**
 * Añade o actualiza una entrada en la cola persistente de reintentos.
 * Reglas de deduplicación:
 *  - isFinalSync reemplaza a assignOnly para el mismo encargo.
 *  - Si ya hay un isFinalSync, se actualiza la anotación con la nueva (por si cambió).
 */
function _enqueueRetry(key, reason, anotacion, assignOnly, isFinalSync) {
  const queue = _loadRetryQueue();
  const idx   = queue.findIndex(e => e.key === key);
  const existing = idx !== -1 ? queue[idx] : null;

  // Si ya hay un finalSync en cola, no reemplazar con un assignOnly
  if (existing && existing.isFinalSync && assignOnly) {
    log.info(`⏭️  Reintento assign-only ignorado (ya hay finalSync en cola) | encargo=${key}`);
    return;
  }

  const now       = Date.now();
  const attempts  = existing ? existing.attempts : 0;
  const backoffMs = (RETRY_BACKOFF_MIN[Math.min(attempts + 1, RETRY_BACKOFF_MIN.length - 1)] || 120) * 60_000;

  const entry = {
    key,
    reason,
    anotacion:   anotacion || (existing?.anotacion || ''),
    assignOnly:  isFinalSync ? false : assignOnly,
    isFinalSync: isFinalSync || (existing?.isFinalSync || false),
    failedAt:    existing?.failedAt || now,
    attempts,
    nextRetryAt: now + backoffMs,
  };

  if (idx !== -1) queue[idx] = entry;
  else            queue.push(entry);

  _saveRetryQueue(queue);
  log.warn(`🔁 Sync añadido a cola de reintentos | encargo=${key} | intento=${attempts + 1}/${MAX_RETRY_ATTEMPTS} | próximo reintento en ${RETRY_BACKOFF_MIN[Math.min(attempts + 1, RETRY_BACKOFF_MIN.length - 1)]} min`);
}

function _removeFromRetryQueue(key) {
  const queue = _loadRetryQueue().filter(e => e.key !== key);
  _saveRetryQueue(queue);
}

// ── Spawn de Playwright ───────────────────────────────────────────────────────

function _spawn(key, reason, anotacion, assignOnly, isFinalSync, isRetry = false) {
  lastRunByEncargo.set(key, Date.now());
  running.add(key);
  runningCount++;

  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'peritoline_sync.js');
  const cwd        = path.join(__dirname, '..', '..');
  const spawnArgs  = [scriptPath, '--encargo', key];
  if (anotacion)   spawnArgs.push('--anotacion', anotacion);
  if (assignOnly)  spawnArgs.push('--assign-only');
  if (isFinalSync) spawnArgs.push('--final-sync');

  const FL     = fileLogger.forNexp(key);
  const retry  = isRetry ? ' [REINTENTO]' : '';
  const header = `=== Sync iniciado${retry} | encargo=${key}${reason ? ` | motivo=${reason}` : ''} ===`;

  // Log recursos antes de lanzar
  resourceMonitor.logStats(`before_spawn_${key}`).then(({ cpuPct, mem }) => {
    log.info(`🚀 PeritoLine auto-sync lanzado${retry} | encargo=${key} | motivo=${reason || ''} | CPU:${cpuPct}% | RAM libre:${mem.freeMB}MB | concurrent:${runningCount}/${MAX_CONCURRENT}`);
  });

  FL.playwright(header);

  const child = spawn(process.execPath, spawnArgs, {
    cwd,
    env: {
      ...process.env,
      PLAYWRIGHT_HEADLESS: String(process.env.PERITOLINE_AUTO_SYNC_HEADLESS || 'true'),
      PLAYWRIGHT_SLOW_MO:  String(process.env.PERITOLINE_AUTO_SYNC_SLOW_MO  || '0'),
      PERITOLINE_DRY_RUN:  String(process.env.PERITOLINE_AUTO_SYNC_DRY_RUN  || 'false'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(chunk);
    text.split('\n').filter(l => l.trim()).forEach(l => FL.playwright(l));
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    process.stderr.write(chunk);
    text.split('\n').filter(l => l.trim()).forEach(l => FL.playwright(`[STDERR] ${l}`));
  });

  child.on('error', (err) => {
    running.delete(key);
    runningCount = Math.max(0, runningCount - 1);
    log.error(`❌ Error lanzando PeritoLine auto-sync | encargo=${key}:`, err.message);
    FL.playwright(`[ERROR] Error lanzando proceso: ${err.message}`);
    FL.error(`Error lanzando PeritoLine auto-sync: ${err.message}`);
    _enqueueRetry(key, reason, anotacion, assignOnly, isFinalSync);
    _afterProcess(key);
  });

  child.on('exit', (code) => {
    running.delete(key);
    runningCount = Math.max(0, runningCount - 1);

    if (code === 0) {
      log.info(`✅ PeritoLine auto-sync finalizado | encargo=${key}`);
      FL.playwright(`=== Sync finalizado OK | encargo=${key} ===`);
      // Éxito: eliminar de cola de reintentos si estaba
      _removeFromRetryQueue(key);
    } else {
      resourceMonitor.logStats(`after_failure_${key}`).then(({ cpuPct, mem }) => {
        log.error(`❌ PeritoLine auto-sync terminó con error | encargo=${key} | code=${code} | CPU:${cpuPct}% | RAM libre:${mem.freeMB}MB`);
      });
      FL.playwright(`[ERROR] Sync terminó con código ${code} | encargo=${key}`);
      FL.error(`PeritoLine auto-sync terminó con error | code=${code}`);
      _enqueueRetry(key, reason, anotacion, assignOnly, isFinalSync);
    }

    _afterProcess(key);
  });

  child.unref();
}

/** Acciones tras finalizar un proceso (éxito o fallo). */
function _afterProcess(key) {
  _drainPendingFinal(key);
  _drainGlobalQueue();
}

/** Ejecuta el final-sync que estaba esperando a que terminara el proceso actual del encargo. */
function _drainPendingFinal(key) {
  if (!pendingFinal.has(key)) return;
  const { anotacion } = pendingFinal.get(key);
  pendingFinal.delete(key);
  log.info(`▶ Ejecutando final-sync pendiente | encargo=${key}`);
  _spawnOrQueue(key, 'pending_final', anotacion, false, true);
}

/** Procesa la cola global (disparado cuando se libera un slot de concurrencia). */
function _drainGlobalQueue() {
  while (globalQueue.length > 0 && runningCount < MAX_CONCURRENT) {
    const next = globalQueue.shift();
    log.info(`▶ Procesando sync en cola global | encargo=${next.key} | pendientes restantes: ${globalQueue.length}`);
    _spawn(next.key, next.reason, next.anotacion, next.assignOnly, next.isFinalSync);
  }
}

/**
 * Lanza el sync si hay slot disponible, o lo encola en la cola global.
 */
function _spawnOrQueue(key, reason, anotacion, assignOnly, isFinalSync, isRetry = false) {
  if (runningCount < MAX_CONCURRENT) {
    _spawn(key, reason, anotacion, assignOnly, isFinalSync, isRetry);
  } else {
    log.info(`⏳ PeritoLine sync en cola global (${runningCount}/${MAX_CONCURRENT} activos) | encargo=${key}`);
    // Si ya hay un assignOnly en cola para este encargo y llega un finalSync, reemplazar
    const existingIdx = globalQueue.findIndex(e => e.key === key);
    if (existingIdx !== -1) {
      const existing = globalQueue[existingIdx];
      if (isFinalSync && !existing.isFinalSync) {
        globalQueue[existingIdx] = { key, reason, anotacion, assignOnly, isFinalSync };
        log.info(`🔄 Cola global: assignOnly reemplazado por finalSync | encargo=${key}`);
      }
    } else {
      globalQueue.push({ key, reason, anotacion, assignOnly, isFinalSync });
    }
  }
}

// ── Scheduler de reintentos ───────────────────────────────────────────────────

async function _processRetryQueue() {
  const queue = _loadRetryQueue();
  if (!queue.length) return;

  const now       = Date.now();
  const due       = queue.filter(e => e.nextRetryAt <= now && e.attempts < MAX_RETRY_ATTEMPTS);
  const overLimit = queue.filter(e => e.attempts >= MAX_RETRY_ATTEMPTS);

  // Purgar los que superaron el límite de reintentos
  if (overLimit.length) {
    overLimit.forEach(e => {
      log.error(`💀 Sync abandonado tras ${e.attempts} intentos | encargo=${e.key} | motivo=${e.reason}`);
      fileLogger.forNexp(e.key).error(`Sync PeritoLine abandonado tras ${e.attempts} intentos | motivo=${e.reason}`);
    });
    _saveRetryQueue(queue.filter(e => e.attempts < MAX_RETRY_ATTEMPTS));
  }

  if (!due.length) return;

  // Solo reintentar si hay recursos disponibles
  const available = await resourceMonitor.isAvailable();
  if (!available) {
    const { cpuPct, mem } = resourceMonitor.getLastStats() || {};
    log.warn(`⚠️  Cola de reintentos: recursos insuficientes, postergando | CPU:${cpuPct}% | RAM libre:${mem?.freeMB}MB | pendientes: ${due.length}`);
    return;
  }

  // Procesar de uno en uno para no saturar
  const entry = due[0];

  // Incrementar intento antes de lanzar
  const updatedQueue = _loadRetryQueue().map(e => {
    if (e.key !== entry.key) return e;
    return { ...e, attempts: e.attempts + 1 };
  });
  _saveRetryQueue(updatedQueue);

  log.info(`🔁 Reintentando sync | encargo=${entry.key} | intento ${entry.attempts + 1}/${MAX_RETRY_ATTEMPTS} | motivo original: ${entry.reason}`);
  fileLogger.forNexp(entry.key).playwright(`=== Reintento ${entry.attempts + 1}/${MAX_RETRY_ATTEMPTS} | motivo=${entry.reason} ===`);

  // Solo lanzar si el encargo no tiene ya un proceso activo
  if (running.has(entry.key)) {
    log.info(`⏭️  Reintento omitido (ya en curso) | encargo=${entry.key}`);
    return;
  }

  _spawnOrQueue(entry.key, `retry_${entry.reason}`, entry.anotacion, entry.assignOnly, entry.isFinalSync, true);
}

// ── API pública ───────────────────────────────────────────────────────────────

function triggerEncargoSync(encargo, reason = '', anotacion = '', assignOnly = false, isFinalSync = false) {
  const key = String(encargo || '').trim();
  if (!key) return;
  if (!AUTO_SYNC_ENABLED) return;

  if (running.has(key)) {
    if (isFinalSync) {
      pendingFinal.set(key, { anotacion });
      log.info(`⏳ PeritoLine final-sync encolado (sync en curso) | encargo=${key}`);
    } else {
      log.info(`⏭️  PeritoLine auto-sync omitido (ya en curso) | encargo=${key}`);
    }
    return;
  }

  // Cooldown solo para syncs no-finales
  const now  = Date.now();
  const last = lastRunByEncargo.get(key) || 0;
  if (!isFinalSync && now - last < AUTO_SYNC_COOLDOWN_MS) {
    log.info(`⏭️  PeritoLine auto-sync omitido (cooldown) | encargo=${key}`);
    return;
  }

  _spawnOrQueue(key, reason, anotacion, assignOnly, isFinalSync);
}

/** Devuelve un resumen del estado actual (para health checks / logs). */
function getQueueStatus() {
  return {
    runningCount,
    maxConcurrent:  MAX_CONCURRENT,
    globalQueueLen: globalQueue.length,
    retryQueueLen:  _loadRetryQueue().length,
    retryQueue:     _loadRetryQueue().map(e => ({
      key:        e.key,
      attempts:   e.attempts,
      isFinalSync: e.isFinalSync,
      nextRetryAt: new Date(e.nextRetryAt).toISOString(),
    })),
  };
}

// ── Arranque ──────────────────────────────────────────────────────────────────

// Iniciar el scheduler de reintentos
const _retryTimer = setInterval(_processRetryQueue, RETRY_CHECK_MS);
if (_retryTimer.unref) _retryTimer.unref();
log.info(`🔁 Scheduler de reintentos PeritoLine iniciado (intervalo: ${RETRY_CHECK_MS / 60_000} min, cola: data/sync_retry_queue.json)`);

// Log inicial del estado de la cola (por si hay reintentos pendientes de antes del restart)
setTimeout(() => {
  const pending = _loadRetryQueue();
  if (pending.length) {
    log.warn(`📋 Cola de reintentos cargada al arranque: ${pending.length} entrada(s) pendiente(s)`);
    pending.forEach(e => log.warn(`   · encargo=${e.key} | intento=${e.attempts}/${MAX_RETRY_ATTEMPTS} | motivo=${e.reason} | próximo: ${new Date(e.nextRetryAt).toISOString()}`));
  }
}, 3000);

module.exports = { triggerEncargoSync, getQueueStatus };
