// src/utils/fileLogger.js — Registro en archivos por expediente (nexp)
//
// Estructura de directorios:
//   logs/
//     [nexp]/
//       bot.log            ← errores e incidencias del bot para este encargo
//       playwright/
//         peritoline.log   ← salida completa de playwright para este encargo
//
// Los directorios se crean automáticamente al primer uso.
// cleanOldLogs() elimina carpetas cuya fecha de creación supera MAX_AGE_DAYS (7).

const fs   = require('fs');
const path = require('path');

const LOGS_DIR     = path.resolve(__dirname, '..', '..', 'logs');
const MAX_AGE_DAYS = 7;
const MAX_AGE_MS   = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

// ── Helpers internos ──────────────────────────────────────────────────────────

function _ensure(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _nexpDir(nexp)       { return path.join(LOGS_DIR, String(nexp)); }
function _playwrightDir(nexp) { return path.join(_nexpDir(nexp), 'playwright'); }

function _append(file, line) {
  try {
    fs.appendFileSync(file, line, 'utf8');
  } catch { /* silencioso: el log nunca debe interrumpir el flujo principal */ }
}

function _ts() {
  return new Date().toISOString();
}

// ── API de escritura ──────────────────────────────────────────────────────────

/**
 * Escribe una línea en logs/[nexp]/bot.log
 * @param {string} nexp
 * @param {'INFO'|'WARN'|'ERROR'} level
 * @param {string} message
 */
function writeLog(nexp, level, message) {
  if (!nexp) return;
  const dir = _nexpDir(nexp);
  _ensure(dir);
  _append(path.join(dir, 'bot.log'), `${_ts()} [${level}] ${message}\n`);
}

/**
 * Escribe una línea en logs/[nexp]/playwright/peritoline.log
 * @param {string} nexp
 * @param {string} message
 */
function writePlaywrightLog(nexp, message) {
  if (!nexp) return;
  const dir = _playwrightDir(nexp);
  _ensure(dir);
  _append(path.join(dir, 'peritoline.log'), `${_ts()} ${message}\n`);
}

// ── Logger contextual (factory) ───────────────────────────────────────────────

/**
 * Devuelve un logger de archivos vinculado a un expediente.
 * @param {string} nexp
 * @returns {{ info(msg:string):void, warn(msg:string):void, error(msg:string):void, playwright(msg:string):void }}
 */
function forNexp(nexp) {
  return {
    info:       (msg) => writeLog(nexp, 'INFO',  msg),
    warn:       (msg) => writeLog(nexp, 'WARN',  msg),
    error:      (msg) => writeLog(nexp, 'ERROR', msg),
    playwright: (msg) => writePlaywrightLog(nexp, msg),
  };
}

// ── Limpieza semanal ──────────────────────────────────────────────────────────

/**
 * Elimina carpetas de logs cuya fecha de apertura (birthtime) supere MAX_AGE_DAYS días.
 * Llamar al arrancar el servidor y después cada semana.
 */
function cleanOldLogs() {
  if (!fs.existsSync(LOGS_DIR)) return;
  const now = Date.now();
  let deleted = 0;
  try {
    for (const entry of fs.readdirSync(LOGS_DIR)) {
      const entryPath = path.join(LOGS_DIR, entry);
      try {
        const stat = fs.statSync(entryPath);
        if (!stat.isDirectory()) continue;
        // birthtimeMs = fecha de creación; ctimeMs como fallback en sistemas sin soporte
        const age = now - (stat.birthtimeMs || stat.ctimeMs);
        if (age >= MAX_AGE_MS) {
          fs.rmSync(entryPath, { recursive: true, force: true });
          deleted++;
        }
      } catch { /* ignorar entradas inaccesibles */ }
    }
  } catch { /* ignorar si LOGS_DIR no es accesible */ }
  if (deleted > 0) {
    console.log(`[fileLogger] 🗑️  Limpieza semanal: ${deleted} carpeta(s) de log eliminada(s) (>${MAX_AGE_DAYS} días)`);
  }
}

module.exports = { forNexp, writeLog, writePlaywrightLog, cleanOldLogs };
