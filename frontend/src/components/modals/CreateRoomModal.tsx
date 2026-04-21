import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { roomsApi } from '../../api/rooms'

export function CreateRoomModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError('')
    setLoading(true)
    try {
      const room = await roomsApi.create(name.trim(), description, isPrivate)
      await queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
      onClose()
      navigate(`/room/${room.id}`)
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Failed to create room')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>Create Room</h3>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-tab-content">
          {error && <div className="error-msg">{error}</div>}
          <form onSubmit={submit}>
            <label>Room name</label>
            <input value={name} onChange={e => setName(e.target.value)} required />
            <label>Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} />
            <label className="checkbox-label">
              <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />
              Private room
            </label>
            <div className="modal-footer">
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
