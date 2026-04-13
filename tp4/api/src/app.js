import express from "express";
import pinoHttp from "pino-http";
import logger from "./logger.js";
import { register, httpRequestsTotal, httpResponseDuration } from "./metrics.js";
import { livenessHandler, createReadinessHandler } from "./health_check.js";

// =======================
// Helpers
// =======================

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringOrUndefined(v) {
  return v === undefined || typeof v === "string";
}

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id. Expected a positive integer." });
    return null;
  }
  return id;
}

export function createApp({ pool }) {
  const app = express();

  app.use(
    pinoHttp({
      logger,
      customLogLevel(req, res, err) {
        if (res.statusCode >= 500 || err) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
      customSuccessMessage(req, res) {
        return `${req.method} ${req.url} completed`;
      },
      customErrorMessage(req, res, err) {
        return err?.message ?? `${req.method} ${req.url} failed`;
      },
      customReceivedMessage(req) {
        return `${req.method} ${req.url} received`;
      },
    }),
  );

  app.use(express.json());

  // =======================
  // Middleware métriques
  // =======================

  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const route = req.route?.path ?? req.path;
      const labels = {
        method: req.method,
        route,
        status_code: res.statusCode,
      };
      httpRequestsTotal.inc(labels);
      httpResponseDuration.observe(labels, Date.now() - start);
    });
    next();
  });

  // =======================
  // Healthcheck
  // =======================

  const readinessHandler = createReadinessHandler({ pool, logger });

  app.get("/live", livenessHandler);
  app.get("/ready", readinessHandler);
  app.get("/health", readinessHandler);

  // =======================
  // Métriques Prometheus
  // =======================

  app.get("/metrics", async (_, res) => {
    res.set("Content-Type", register.contentType);
    res.send(await register.metrics());
  });

  // =======================
  // CRUD NOTES
  // =======================

  // GET /notes
  app.get("/notes", async (_, res) => {
    logger.info("Fetching all notes");

    const result = await pool.query(
      "SELECT * FROM notes ORDER BY created_at DESC",
    );
    res.json(result.rows);
  });

  // POST /notes
  app.post("/notes", async (req, res) => {
    const { title, content } = req.body;

    logger.info({ title }, "Creating note");

    if (!isNonEmptyString(title)) {
      return res.status(400).json({
        error: "title is required",
      });
    }

    const result = await pool.query(
      "INSERT INTO notes (title, content) VALUES ($1, $2) RETURNING *",
      [title, content],
    );

    logger.info({ id: result.rows[0].id }, "Note created");

    res.status(201).json(result.rows[0]);
  });

  // PUT /notes/:id
  app.put("/notes/:id", async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;

    const { title, content } = req.body;

    logger.info({ id }, "Updating note");

    if (!isNonEmptyString(title)) {
      return res.status(400).json({
        error: "title is required and must be a non-empty string",
      });
    }

    if (!isStringOrUndefined(content)) {
      return res.status(400).json({
        error: "content must be a string if provided",
      });
    }

    const result = await pool.query(
      `
    UPDATE notes
    SET title = $1,
        content = $2
    WHERE id = $3
    RETURNING *
    `,
      [title.trim(), content ?? "", id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "note not found" });
    }

    logger.info({ id }, "Note updated");

    res.json(result.rows[0]);
  });

  // GET /notes/:id
  app.get("/notes/:id", async (req, res) => {
    const { id } = req.params;

    logger.info({ id }, "Fetching note");

    const result = await pool.query("SELECT * FROM notes WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "note not found" });
    }

    res.json(result.rows[0]);
  });

  // DELETE /notes/:id
  app.delete("/notes/:id", async (req, res) => {
    const { id } = req.params;

    logger.info({ id }, "Deleting note");

    const result = await pool.query(
      "DELETE FROM notes WHERE id = $1 RETURNING *",
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "note not found" });
    }

    logger.info({ id }, "Note deleted");

    res.status(204).send();
  });

  // =======================
  // Not found handler
  // =======================

  app.use((req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
  });

  return app;
}