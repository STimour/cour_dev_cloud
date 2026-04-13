
function baseHealth() {
  return {
    service: "notes-api",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
  };
}

export function livenessHandler(_, res) {
  return res.status(200).json({
    ...baseHealth(),
    status: "ok",
    probe: "liveness",
  });
}

export function createReadinessHandler({ pool, logger }) {
  return async function readinessHandler(_, res) {
    try {
      await pool.query("SELECT 1");

      return res.status(200).json({
        ...baseHealth(),
        status: "ok",
        probe: "readiness",
        dependencies: {
          database: "up",
        },
      });
    } catch (err) {
      logger.error({ err }, "Readiness failed: database unavailable");

      return res.status(503).json({
        ...baseHealth(),
        status: "error",
        probe: "readiness",
        dependencies: {
          database: "down",
        },
      });
    }
  };
}