import pkg from "pg";

const { Pool } = pkg;

// =======================
// Configuration DB
// =======================

export function createPoolFromEnv() {
  return new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
}

export async function waitForDb(pool, retries = 5, delay = 3000) {
  while (retries > 0) {
    try {
      await pool.query("SELECT 1");
      console.log("Database ready");
      return;
    } catch (err) {
      retries--;
      console.log("Waiting for database...", retries);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error("Database not reachable");
}