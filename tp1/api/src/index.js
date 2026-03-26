import express from "express";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(express.json());

// =======================
// Configuration DB
// =======================

const pool = new Pool({});

// =======================
// Healthcheck 
// =======================

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

let port = 3000;

app.listen(port, () => {
  console.log(`API running on port ${port}`);
});