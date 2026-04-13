import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

import authMiddleware from '../auth.js'

// Minimal app to test the middleware in isolation
const app = express()
app.use(express.json())
app.use(authMiddleware)
app.get('/api/tasks', (_req, res) => res.json({ ok: true }))
app.post('/api/users/login', (_req, res) => res.json({ ok: true }))
app.post('/api/users/register', (_req, res) => res.json({ ok: true }))

const JWT_SECRET = 'dev-secret'
const VALID_TOKEN = jwt.sign({ userId: 'uuid-alice', email: 'alice@taskflow.dev' }, JWT_SECRET)

describe('authMiddleware — routes publiques', () => {
  it('laisse passer POST /api/users/login sans token', async () => {
    const res = await request(app).post('/api/users/login').send({})
    expect(res.status).toBe(200)
  })

  it('laisse passer POST /api/users/register sans token', async () => {
    const res = await request(app).post('/api/users/register').send({})
    expect(res.status).toBe(200)
  })

  it('laisse passer GET /health sans token', async () => {
    const appWithHealth = express()
    appWithHealth.use(authMiddleware)
    appWithHealth.get('/health', (_req, res) => res.json({ ok: true }))

    const res = await request(appWithHealth).get('/health')
    expect(res.status).toBe(200)
  })
})

describe('authMiddleware — routes protégées', () => {
  it('retourne 401 sans header Authorization', async () => {
    const res = await request(app).get('/api/tasks')
    expect(res.status).toBe(401)
  })

  it('retourne 401 avec un token malformé', async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', 'Bearer token_invalide')
    expect(res.status).toBe(401)
  })

  it('retourne 401 avec un token expiré', async () => {
    const expiredToken = jwt.sign(
      { userId: 'uuid-alice', email: 'alice@taskflow.dev' },
      JWT_SECRET,
      { expiresIn: -1 } // already expired
    )
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${expiredToken}`)
    expect(res.status).toBe(401)
  })

  it('laisse passer avec un token valide et injecte x-user-id', async () => {
    let capturedHeaders = {}
    const appWithCapture = express()
    appWithCapture.use(authMiddleware)
    appWithCapture.get('/api/tasks', (req, res) => {
      capturedHeaders = req.headers
      res.json({ ok: true })
    })

    const res = await request(appWithCapture)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)

    expect(res.status).toBe(200)
    expect(capturedHeaders['x-user-id']).toBe('uuid-alice')
    expect(capturedHeaders['x-user-email']).toBe('alice@taskflow.dev')
  })
})
