'use strict';

/**
 * loopsStatus.js
 *
 * Shared in-memory state for the auto-loops that keep /bri populated
 * (recording sweep, packet backfill, analysis backfill). Each loop writes
 * its own status block after every tick so the /collect/x/loops-status
 * endpoint + the dashboard can show whether the loops are actually alive
 * instead of just promising "every 10m".
 *
 * State is ephemeral — resets on every server boot. That's fine: the
 * purpose is runtime health, not historical audit.
 */

const loops = Object.create(null);

/**
 * Register a loop. Called once by each loop at startup.
 * @param {string} name                — unique id, e.g. "sweep"
 * @param {number} intervalMs          — tick period
 * @param {number} firstDelayMs        — delay before first tick
 */
function register(name, intervalMs, firstDelayMs) {
  loops[name] = {
    name,
    intervalMs,
    firstDelayMs,
    registeredAt: new Date(),
    lastRunAt: null,
    lastRunDurationMs: null,
    lastResult: null,
    lastError: null,
    runCount: 0,
    errorCount: 0,
    nextRunAt: new Date(Date.now() + firstDelayMs),
  };
}

/**
 * Record the start of a tick. Caller must also call finish().
 */
function start(name) {
  const s = loops[name];
  if (!s) return { tickStart: Date.now() };
  s.nextRunAt = null;
  return { tickStart: Date.now() };
}

/**
 * Record the end of a tick.
 * @param {string} name
 * @param {{tickStart:number}} ctx      — value returned by start()
 * @param {object|null} result          — arbitrary summary (e.g. { built, failed })
 * @param {Error|null}  err
 */
function finish(name, ctx, result, err) {
  const s = loops[name];
  if (!s) return;
  const now = Date.now();
  s.lastRunAt = new Date(now);
  s.lastRunDurationMs = now - (ctx?.tickStart || now);
  s.runCount += 1;
  s.nextRunAt = new Date(now + s.intervalMs);
  if (err) {
    s.errorCount += 1;
    s.lastError = { message: String(err.message || err).slice(0, 240), at: new Date(now) };
    s.lastResult = null;
  } else {
    s.lastResult = result || null;
    // Keep lastError around as history — don't clear it.
  }
}

/**
 * Snapshot of all registered loops for the /loops-status endpoint.
 */
function snapshot() {
  return Object.values(loops).map((s) => ({
    name: s.name,
    intervalMs: s.intervalMs,
    firstDelayMs: s.firstDelayMs,
    registeredAt: s.registeredAt,
    lastRunAt: s.lastRunAt,
    lastRunDurationMs: s.lastRunDurationMs,
    lastResult: s.lastResult,
    lastError: s.lastError,
    runCount: s.runCount,
    errorCount: s.errorCount,
    nextRunAt: s.nextRunAt,
  }));
}

module.exports = { register, start, finish, snapshot };
