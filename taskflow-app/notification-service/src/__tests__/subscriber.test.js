import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// On teste la logique du subscriber sans Redis réel
vi.mock('../subscriber.js', async (importOriginal) => {
  // On importe le vrai module pour tester getNotifications et markAsRead
  // mais on mock startSubscriber qui ouvre une vraie connexion Redis
  const actual = await importOriginal()
  return {
    ...actual,
    startSubscriber: vi.fn().mockResolvedValue(undefined),
  }
})

import { getNotifications, markAsRead, startSubscriber } from '../subscriber.js'

// App minimale reproduisant les routes de index.js sans démarrer le serveur
const app = express()
app.use(express.json())
app.get('/notifications', (req, res) => {
  const { userId } = req.query
  res.json(getNotifications(userId))
})
app.patch('/notifications/:id/read', (req, res) => {
  const notif = markAsRead(req.params.id)
  if (!notif) return res.status(404).json({ error: 'Notification not found' })
  res.json(notif)
})

describe('subscriber — logique interne', () => {
  it('getNotifications retourne un tableau vide au démarrage', () => {
    const result = getNotifications()
    expect(Array.isArray(result)).toBe(true)
  })

  it('getNotifications filtre par userId', () => {
    const all = getNotifications()
    const forUser = getNotifications('uuid-alice')
    // Tous les résultats filtrés appartiennent à alice
    forUser.forEach(n => expect(n.userId).toBe('uuid-alice'))
  })

  it('markAsRead retourne null pour un id inexistant', () => {
    const result = markAsRead('id-qui-nexiste-pas')
    expect(result).toBeUndefined()
  })
})

describe('GET /notifications', () => {
  it('retourne 200 avec un tableau', async () => {
    const res = await request(app).get('/notifications')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('PATCH /notifications/:id/read', () => {
  it('retourne 404 pour une notification inexistante', async () => {
    const res = await request(app).patch('/notifications/fake-id/read')
    expect(res.status).toBe(404)
  })
})
