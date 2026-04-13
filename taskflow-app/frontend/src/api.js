const BASE = '/api'

function getToken() {
  return localStorage.getItem('token')
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Request failed')
  }

  if (res.status === 204) return null
  return res.json()
}

export const api = {
  // Auth
  register: (data) => request('POST', '/users/register', data),
  login: (data) => request('POST', '/users/login', data),

  // Tasks
  getTasks: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request('GET', `/tasks${qs ? '?' + qs : ''}`)
  },
  createTask: (data) => request('POST', '/tasks', data),
  updateTask: (id, data) => request('PATCH', `/tasks/${id}`, data),
  deleteTask: (id) => request('DELETE', `/tasks/${id}`),

  // Users
  getUsers: () => request('GET', '/users'),

  // Notifications
  getNotifications: (userId) => request('GET', `/notifications?userId=${userId}`),
  markRead: (id) => request('PATCH', `/notifications/${id}/read`),
}
