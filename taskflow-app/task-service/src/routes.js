const express = require("express");
const { trace } = require("@opentelemetry/api");
const db = require("./db");
const { publish } = require("./publisher");
const {
  tasksCreatedTotal,
  tasksStatusChangesTotal,
  tasksGauge,
} = require("./metrics");

const router = express.Router();
const tracer = trace.getTracer("task-service");

const normalizePriority = (priority) => {
  const valid = ["low", "medium", "high"];
  return valid.includes(priority) ? priority : "medium";
};

async function refreshTasksGauge() {
  try {
    const result = await db.query(
      "SELECT status, COUNT(*)::int AS total FROM tasks GROUP BY status",
    );
    tasksGauge.reset();
    result.rows.forEach((row) => {
      tasksGauge.set({ status: row.status }, Number(row.total));
    });
  } catch (err) {
    console.error("Failed to refresh tasks_gauge", err);
  }
}

async function publishWithSpan(spanName, eventName, payload) {
  const span = tracer.startSpan(spanName, {
    attributes: {
      "messaging.system": "redis",
      "messaging.destination": eventName,
    },
  });

  try {
    await publish(eventName, payload);
  } finally {
    span.end();
  }
}

// GET /tasks
router.get("/", async (req, res) => {
  try {
    const { priority, status, assignee_id } = req.query;
    let query = "SELECT * FROM tasks";
    const params = [];
    const conditions = [];

    if (priority) {
      conditions.push(`priority = $${params.length + 1}`);
      params.push(priority);
    }
    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }
    if (assignee_id) {
      conditions.push(`assignee_id = $${params.length + 1}`);
      params.push(assignee_id);
    }
    if (conditions.length) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY created_at DESC";
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /tasks/:id
router.get("/:id", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM tasks WHERE id = $1", [
      req.params.id,
    ]);
    if (!result.rows[0])
      return res.status(404).json({ error: "Task not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /tasks
router.post("/", async (req, res) => {
  const { title, description, priority, assignee_id, due_date, created_by } =
    req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  try {
    const result = await db.query(
      `INSERT INTO tasks (title, description, priority, assignee_id, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        title,
        description,
        priority || "medium",
        assignee_id,
        due_date,
        created_by,
      ],
    );
    const task = result.rows[0];
    tasksCreatedTotal.inc({ priority: normalizePriority(task.priority) });

    await publishWithSpan("publish.task.created", "task.created", {
      taskId: task.id,
      title: task.title,
      assigneeId: task.assignee_id,
    });

    await refreshTasksGauge();

    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /tasks/:id
router.patch("/:id", async (req, res) => {
  const { title, description, status, priority, assignee_id, due_date } =
    req.body;
  try {
    const current = await db.query("SELECT * FROM tasks WHERE id = $1", [
      req.params.id,
    ]);
    if (!current.rows[0])
      return res.status(404).json({ error: "Task not found" });

    const result = await db.query(
      `UPDATE tasks SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        status = COALESCE($3, status),
        priority = COALESCE($4, priority),
        assignee_id = COALESCE($5, assignee_id),
        due_date = COALESCE($6, due_date),
        updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [
        title,
        description,
        status,
        priority,
        assignee_id,
        due_date,
        req.params.id,
      ],
    );
    const task = result.rows[0];

    if (status && status !== current.rows[0].status) {
      tasksStatusChangesTotal.inc({
        from_status: current.rows[0].status,
        to_status: status,
      });

      await publishWithSpan("publish.task.status_changed", "task.status_changed", {
        taskId: task.id,
        oldStatus: current.rows[0].status,
        newStatus: status,
        assigneeId: task.assignee_id,
      });
    }

    await refreshTasksGauge();

    res.json(task);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /tasks/:id
router.delete("/:id", async (req, res) => {
  try {
    const result = await db.query(
      "DELETE FROM tasks WHERE id = $1 RETURNING id",
      [req.params.id],
    );
    if (!result.rows[0])
      return res.status(404).json({ error: "Task not found" });

    await refreshTasksGauge();

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
