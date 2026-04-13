import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useAuth } from '../AuthContext'

function TaskModal({ onClose, onCreated, users }) {
  const { user } = useAuth()
  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium', assignee_id: '', due_date: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const payload = { ...form, created_by: user.id }
      if (!payload.assignee_id) delete payload.assignee_id
      if (!payload.due_date) delete payload.due_date
      const task = await api.createTask(payload)
      onCreated(task)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>New task</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Title *</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required autoFocus />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Priority</label>
            <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="form-group">
            <label>Assigned to</label>
            <select value={form.assignee_id} onChange={e => setForm({ ...form, assignee_id: e.target.value })}>
              <option value="">— Nobody —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Due date</label>
            <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TaskCard({ task, users, onUpdated, onDeleted }) {
  const assignee = users.find(u => u.id === task.assignee_id)

  async function handleStatusChange(e) {
    const updated = await api.updateTask(task.id, { status: e.target.value })
    onUpdated(updated)
  }

  async function handleDelete() {
    if (!confirm('Delete this task?')) return
    await api.deleteTask(task.id)
    onDeleted(task.id)
  }

  return (
    <div className="card task-card">
      <div className="task-card-header">
        <span className="task-card-title">{task.title}</span>
        <span className={`badge ${task.priority}`}>{task.priority}</span>
      </div>
      {task.description && <p className="task-card-desc">{task.description}</p>}
      <div className="task-card-meta">
        <span className={`badge ${task.status}`}>{task.status.replace('_', ' ')}</span>
        {assignee && <span style={{ fontSize: 12, color: 'var(--muted)' }}>→ {assignee.name}</span>}
        {task.due_date && (
          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            {new Date(task.due_date).toLocaleDateString('en-US')}
          </span>
        )}
      </div>
      <div className="task-card-actions">
        <select value={task.status} onChange={handleStatusChange}>
          <option value="todo">Todo</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
        <button className="danger" onClick={handleDelete}>delete</button>
      </div>
    </div>
  )
}

export default function TasksPage() {
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const [filter, setFilter] = useState({ status: '', priority: '' })
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadTasks = useCallback(async () => {
    const params = {}
    if (filter.status) params.status = filter.status
    if (filter.priority) params.priority = filter.priority
    const data = await api.getTasks(params)
    setTasks(data)
  }, [filter])

  useEffect(() => {
    Promise.all([loadTasks(), api.getUsers().then(setUsers)]).finally(() => setLoading(false))
  }, [loadTasks])

  return (
    <>
      <div className="page-header">
        <h1>Tasks — {tasks.length}</h1>
        <button className="primary" onClick={() => setShowModal(true)}>+ New task</button>
      </div>

      <div className="task-filters">
        <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="todo">Todo</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
        <select value={filter.priority} onChange={e => setFilter({ ...filter, priority: e.target.value })}>
          <option value="">All priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      {loading ? (
        <div className="empty-state">loading...</div>
      ) : tasks.length === 0 ? (
        <div className="empty-state">no tasks — create one</div>
      ) : (
        <div className="task-grid">
          {tasks.map(t => (
            <TaskCard
              key={t.id}
              task={t}
              users={users}
              onUpdated={updated => setTasks(ts => ts.map(t => t.id === updated.id ? updated : t))}
              onDeleted={id => setTasks(ts => ts.filter(t => t.id !== id))}
            />
          ))}
        </div>
      )}

      {showModal && (
        <TaskModal
          users={users}
          onClose={() => setShowModal(false)}
          onCreated={task => setTasks(ts => [task, ...ts])}
        />
      )}
    </>
  )
}
