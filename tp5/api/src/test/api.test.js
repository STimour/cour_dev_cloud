import request from "supertest";
import { describe, it, expect, vi } from "vitest";
import { createApp } from "../app.js";

describe("API", () => {
  it("GET /live -> 200 with liveness payload", async () => {
    const pool = { query: vi.fn() };
    const app = createApp({ pool });

    const res = await request(app).get("/live");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.probe).toBe("liveness");
    expect(res.body).not.toHaveProperty("dependencies");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("GET /ready -> 200 when DB answers", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const app = createApp({ pool });

    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.probe).toBe("readiness");
    expect(res.body.dependencies).toEqual({ database: "up" });
    expect(pool.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("GET /health -> 503 when DB is down", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("db down")) };
    const app = createApp({ pool });

    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("error");
    expect(res.body.probe).toBe("readiness");
    expect(res.body.dependencies).toEqual({ database: "down" });
    expect(pool.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("POST /notes without title -> 400", async () => {
    const pool = { query: vi.fn() }; // ne doit même pas être appelé
    const app = createApp({ pool });

    const res = await request(app).post("/notes").send({ content: "yo" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "title is required" });
    expect(pool.query).not.toHaveBeenCalled();
  });
});