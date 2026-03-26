import express from "express";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(express.json());

// =======================
// Configuration DB
// =======================

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function waitForDb(retries = 5, delay = 3000) {
  while (retries > 0) {
    try {
      await pool.query("SELECT 1");
      console.log("Database ready");
      return;
    } catch (err) {
      retries--;
      console.log("Waiting for database...", retries);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw new Error("Database not reachable");
}

waitForDb();

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
    "SELECT * FROM notes ORDER BY created_at DESC"
  );
  res.json(result.rows);
});

// POST /notes
app.post("/notes", async (req, res) => {
  const { title, content } = req.body;

  if (!title || title.trim() === "") {
    return res.status(400).json({ error: "title is required" });
  }

  const result = await pool.query(
    "INSERT INTO notes (title, content) VALUES ($1, $2) RETURNING *",
    [title, content]
  );

  res.status(201).json(result.rows[0]);
});

// GET /notes/:id
app.get("/notes/:id", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    "SELECT * FROM notes WHERE id = $1",
    [id]
  );

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
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "note not found" });
  }

  res.status(204).send();
});

// =======================
// Start server
// =======================

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`API running on port ${port}`);
});