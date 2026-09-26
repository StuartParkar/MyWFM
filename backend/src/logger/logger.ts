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
  // `object`, not `Record<string, unknown>`: a named interface/type without
  // its own index signature isn't assignable to Record<string, unknown> at
  // call sites (TS2345), which would force every caller to spread into a
  // fresh literal for no real benefit - `object` accepts any non-primitive
  // shape without that friction.
  debug(meta: object, msg: string): void;
  info(meta: object, msg: string): void;
  warn(meta: object, msg: string): void;
  error(meta: object, msg: string): void;
  critical(meta: object, msg: string): void;
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
