import express from "express";
import logger from "./logger.js";

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
  app.use(express.json());

  // =======================
  // Healthcheck
  // =======================

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