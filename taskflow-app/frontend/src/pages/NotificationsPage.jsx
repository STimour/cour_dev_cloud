import { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuth } from '../AuthContext'

export default function NotificationsPage() {
  const { user } = useAuth()
  const [notifs, setNotifs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getNotifications(user.id)
      .then(setNotifs)
      .finally(() => setLoading(false))
  }, [user.id])

  async function handleMarkRead(id) {
    const updated = await api.markRead(id)
    setNotifs(ns => ns.map(n => n.id === id ? { ...n, read: true } : n))
  }

  const unread = notifs.filter(n => !n.read).length

  return (
    <>
      <div className="page-header">
        <h1>Notifications {unread > 0 && `— ${unread} unread`}</h1>
      </div>

      {loading ? (
        <div className="empty-state">loading...</div>
      ) : notifs.length === 0 ? (
        <div className="empty-state">no notifications</div>
      ) : (
        <div className="notif-list">
          {notifs.map(n => (
            <div key={n.id} className={`card notif-card ${n.read ? '' : 'unread'}`}>
              {!n.read && <div className="notif-dot" />}
              <div className="notif-content">
                <p className="notif-message">{n.message}</p>
                <p className="notif-time">{new Date(n.createdAt).toLocaleString('en-US')}</p>
              </div>
              {!n.read && (
                <button onClick={() => handleMarkRead(n.id)}>mark as read</button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
