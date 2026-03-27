import express from "express";

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

  app.get("/health", async (_, res) => {
    try {
      await pool.query("SELECT 1");
      res.send("ok");
    } catch (err) {
      res.status(500).send("db not ready");
    }
  });

  // =======================
  // CRUD NOTES
  // =======================

  // GET /notes
  app.get("/notes", async (_, res) => {
    const result = await pool.query(
      "SELECT * FROM notes ORDER BY created_at DESC",
    );
    res.json(result.rows);
  });

  // POST /notes
  app.post("/notes", async (req, res) => {
    const { title, content } = req.body;

    if (!isNonEmptyString(title)) {
      return res.status(400).json({
        error: "title is required",
      });
    }

    const result = await pool.query(
      "INSERT INTO notes (title, content) VALUES ($1, $2) RETURNING *",
      [title, content],
    );

    res.status(201).json(result.rows[0]);
  });

  // PUT /notes/:id
  app.put("/notes/:id", async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;

    const { title, content } = req.body;

    // PUT = remplacement complet → title obligatoire
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

    res.json(result.rows[0]);
  });

  // GET /notes/:id
  app.get("/notes/:id", async (req, res) => {
    const { id } = req.params;

    const result = await pool.query("SELECT * FROM notes WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "note not found" });
    }

    res.json(result.rows[0]);
  });

  // DELETE /notes/:id
  app.delete("/notes/:id", async (req, res) => {
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM notes WHERE id = $1 RETURNING *",
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "note not found" });
    }

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