import pino from "pino";
import { env } from "../config/env.js";

/**
 * Structured JSON logger. Build spec section 66 asks for exactly five levels
 * (DEBUG, INFO, WARN, ERROR, CRITICAL); pino's own levels are
 * trace/debug/info/warn/error/fatal, so this thin wrapper exposes the five
 * names the spec asks for and maps CRITICAL onto pino's `fatal`.
 */
const base = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  formatters: {
    level(label) {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(env.NODE_ENV !== "production"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
        },
      }
    : {}),
});

export interface AppLogger {
  debug(meta: Record<string, unknown>, msg: string): void;
  info(meta: Record<string, unknown>, msg: string): void;
  warn(meta: Record<string, unknown>, msg: string): void;
  error(meta: Record<string, unknown>, msg: string): void;
  critical(meta: Record<string, unknown>, msg: string): void;
  child(bindings: Record<string, unknown>): AppLogger;
}

function wrap(target: pino.Logger): AppLogger {
  return {
    debug: (meta, msg) => target.debug(meta, msg),
    info: (meta, msg) => target.info(meta, msg),
    warn: (meta, msg) => target.warn(meta, msg),
    error: (meta, msg) => target.error(meta, msg),
    critical: (meta, msg) => target.fatal(meta, msg),
    child: (bindings) => wrap(target.child(bindings)),
  };
}

export const logger = wrap(base);
export const pinoInstance = base;
