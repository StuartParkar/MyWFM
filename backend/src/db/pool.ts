import sql from "mssql";
import { env } from "../config/env.js";
import { logger } from "../logger/logger.js";

const config: sql.config = {
  server: env.SQL_SERVER_HOST,
  port: env.SQL_SERVER_PORT,
  database: env.SQL_SERVER_DATABASE,
  user: env.SQL_SERVER_USER,
  password: env.SQL_SERVER_PASSWORD,
  options: {
    encrypt: env.SQL_SERVER_ENCRYPT,
    trustServerCertificate: env.SQL_SERVER_TRUST_SERVER_CERTIFICATE,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool: sql.ConnectionPool | undefined;
let connecting: Promise<sql.ConnectionPool> | undefined;

/**
 * Lazily connects a single shared pool. The server is allowed to boot even if
 * this first connection attempt fails - see server.ts and the /api/system-health
 * endpoint, which reports DB connectivity rather than assuming it.
 */
export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  if (connecting) return connecting;

  connecting = new sql.ConnectionPool(config)
    .connect()
    .then((connectedPool) => {
      pool = connectedPool;
      pool.on("error", (err) => {
        logger.error({ err }, "SQL Server pool emitted an error event");
      });
      logger.info({ host: env.SQL_SERVER_HOST, database: env.SQL_SERVER_DATABASE }, "Connected to SQL Server");
      return connectedPool;
    })
    .finally(() => {
      connecting = undefined;
    });

  return connecting;
}

export interface DbHealth {
  status: "UP" | "DOWN";
  latencyMs?: number;
  error?: string;
}

export async function checkDbHealth(): Promise<DbHealth> {
  const start = Date.now();
  try {
    const connectedPool = await getPool();
    await connectedPool.request().query("SELECT 1 AS ok");
    return { status: "UP", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "DOWN", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function closePool(): Promise<void> {
  if (pool?.connected) {
    await pool.close();
    pool = undefined;
  }
}

export { sql };
