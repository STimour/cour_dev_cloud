import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock pg — no real DB used
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

// Mock bcrypt to avoid spending time on hashing in tests
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed_password'),
    compare: vi.fn(),
  },
}))

// Mock jsonwebtoken
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn().mockReturnValue('mock_token'),
  },
}))

import db from '../db.js'
import bcrypt from 'bcrypt'
import routes from '../routes.js'

const app = express()
app.use(express.json())
app.use('/users', routes)

const MOCK_USER = {
  id: 'uuid-alice',
  email: 'alice@taskflow.dev',
  name: 'Alice',
  password_hash: 'hashed_password',
  created_at: new Date().toISOString(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /users/register', () => {
  it('crée un utilisateur et retourne 201', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: MOCK_USER.id, email: MOCK_USER.email, name: MOCK_USER.name, created_at: MOCK_USER.created_at }],
    })

    const res = await request(app)
      .post('/users/register')
      .send({ email: 'alice@taskflow.dev', password: 'password123', name: 'Alice' })

    expect(res.status).toBe(201)
    expect(res.body.email).toBe('alice@taskflow.dev')
    expect(res.body.password_hash).toBeUndefined() // ne jamais exposer le hash
  })

  it('retourne 400 si un champ est manquant', async () => {
    const res = await request(app)
      .post('/users/register')
      .send({ email: 'alice@taskflow.dev' }) // password et name manquants

    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('retourne 409 si email déjà existant', async () => {
    db.query.mockRejectedValueOnce({ code: '23505' }) // code PG unique violation

    const res = await request(app)
      .post('/users/register')
      .send({ email: 'alice@taskflow.dev', password: 'password123', name: 'Alice' })

    expect(res.status).toBe(409)
  })
})

describe('POST /users/login', () => {
  it('retourne un token si les credentials sont valides', async () => {
    db.query.mockResolvedValueOnce({ rows: [MOCK_USER] })
    bcrypt.compare.mockResolvedValueOnce(true)

    const res = await request(app)
      .post('/users/login')
      .send({ email: 'alice@taskflow.dev', password: 'password123' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBe('mock_token')
    expect(res.body.user.email).toBe('alice@taskflow.dev')
  })

  it('retourne 401 si utilisateur introuvable', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app)
      .post('/users/login')
      .send({ email: 'nobody@taskflow.dev', password: 'password123' })

    expect(res.status).toBe(401)
  })

  it('retourne 401 si mot de passe incorrect', async () => {
    db.query.mockResolvedValueOnce({ rows: [MOCK_USER] })
    bcrypt.compare.mockResolvedValueOnce(false)

    const res = await request(app)
      .post('/users/login')
      .send({ email: 'alice@taskflow.dev', password: 'mauvais' })

    expect(res.status).toBe(401)
  })
})

describe('GET /users/:id', () => {
  it('retourne un utilisateur par id', async () => {
    db.query.mockResolvedValueOnce({ rows: [MOCK_USER] })

    const res = await request(app).get(`/users/${MOCK_USER.id}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(MOCK_USER.id)
  })

  it('retourne 404 si introuvable', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app).get('/users/uuid-inexistant')

    expect(res.status).toBe(404)
  })
})
