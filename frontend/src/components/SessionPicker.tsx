import { useEffect, useRef, useState } from 'react'
import { cancelIngest, fetchAvailableSessions, fetchIngestProgress, postIngest } from '../api/client'
import type { AvailableSession } from '../types'

interface Props {
  onSelect: (raceId: string) => void
}

const YEARS = [2025, 2024, 2023]

function generateRaceId(session: AvailableSession): string {
  const country = session.country_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  const year = session.year
  const nameMap: Record<string, string> = {
    'Practice 1': 'p1',
    'Practice 2': 'p2',
    'Practice 3': 'p3',
    'Qualifying': 'q',
    'Race': 'r',
    'Sprint': 's',
    'Sprint Qualifying': 'sq',
    'Sprint Shootout': 'ss',
  }
  const code = nameMap[session.session_name] ?? session.session_name.toLowerCase().replace(/\s+/g, '-')
  return `${country}-${year}-${code}`
}

function groupByEvent(sessions: AvailableSession[]): Map<string, AvailableSession[]> {
  const map = new Map<string, AvailableSession[]>()
  for (const s of sessions) {
    const key = s.event_name || s.country_name
    const arr = map.get(key) ?? []
    arr.push(s)
    map.set(key, arr)
  }
  return map
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 7
  const circumference = 2 * Math.PI * r
  const progress = total > 0 ? done / total : 0
  const offset = circumference * (1 - progress)
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="9" cy="9" r={r} fill="none" stroke="#555" strokeWidth="2" />
      <circle
        cx="9" cy="9" r={r}
        fill="none" stroke="#e10600" strokeWidth="2"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 9 9)"
        style={{ transition: 'stroke-dashoffset 0.4s ease' }}
      />
    </svg>
  )
}

type IngestProgress = { done: number; total: number; raceId: string }

export function SessionPicker({ onSelect }: Props) {
  const [year, setYear] = useState(2024)
  const [sessions, setSessions] = useState<AvailableSession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ingestProgress, setIngestProgress] = useState<Map<number, IngestProgress>>(new Map())
  const pollRefs = useRef<Map<number, ReturnType<typeof setInterval>>>(new Map())

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchAvailableSessions(year)
      .then(setSessions)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [year])

  function stopPoll(sessionKey: number) {
    const id = pollRefs.current.get(sessionKey)
    if (id !== undefined) {
      clearInterval(id)
      pollRefs.current.delete(sessionKey)
    }
  }

  function startProgressPoll(sessionKey: number, raceId: string) {
    const id = setInterval(async () => {
      try {
        const prog = await fetchIngestProgress(raceId)
        setIngestProgress((prev) => {
          const next = new Map(prev)
          next.set(sessionKey, { done: prog.done, total: prog.total, raceId })
          return next
        })

        if (prog.status === 'done') {
          stopPoll(sessionKey)
          setSessions((prev) =>
            prev.map((s) =>
              s.session_key === sessionKey ? { ...s, ingested: true, race_id: raceId } : s
            )
          )
          setIngestProgress((prev) => { const next = new Map(prev); next.delete(sessionKey); return next })
        } else if (prog.status === 'cancelled' || prog.status === 'error') {
          stopPoll(sessionKey)
          setIngestProgress((prev) => { const next = new Map(prev); next.delete(sessionKey); return next })
        }
      } catch {
        // ignore transient poll errors
      }
    }, 1000)
    pollRefs.current.set(sessionKey, id)
  }

  async function handleIngest(session: AvailableSession) {
    const raceId = generateRaceId(session)
    setIngestProgress((prev) => new Map(prev).set(session.session_key, { done: 0, total: 0, raceId }))

    try {
      await postIngest(raceId, session.session_key)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.includes('409')) {
        setIngestProgress((prev) => { const next = new Map(prev); next.delete(session.session_key); return next })
        setError(`Ingest failed: ${msg}`)
        return
      }
    }

    startProgressPoll(session.session_key, raceId)
  }

  async function handleCancel(sessionKey: number, raceId: string) {
    stopPoll(sessionKey)
    setIngestProgress((prev) => { const next = new Map(prev); next.delete(sessionKey); return next })
    try {
      await cancelIngest(raceId)
    } catch {
      // best-effort cancel
    }
  }

  useEffect(() => {
    return () => { pollRefs.current.forEach((_, key) => stopPoll(key)) }
  }, [])

  const grouped = groupByEvent(sessions)

  return (
    <div style={{ padding: '16px', maxWidth: '700px' }}>
      <h2 style={{ margin: '0 0 12px' }}>Select a Session</h2>

      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <label style={{ fontWeight: 'bold' }}>Year:</label>
        {YEARS.map((y) => (
          <button
            key={y}
            onClick={() => setYear(y)}
            style={{
              padding: '4px 12px',
              cursor: 'pointer',
              fontWeight: year === y ? 'bold' : 'normal',
              background: year === y ? '#e10600' : '#333',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
            }}
          >
            {y}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#888', fontFamily: 'monospace' }}>Loading sessions…</p>}
      {error && <p style={{ color: '#f55' }}>Error: {error}</p>}

      {!loading && !error && sessions.length === 0 && (
        <p style={{ color: '#888' }}>No sessions found for {year}.</p>
      )}

      {Array.from(grouped.entries()).map(([eventName, eventSessions]) => (
        <div key={eventName} style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: '14px', color: '#aaa', textTransform: 'uppercase' }}>
            {eventName}
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {eventSessions.map((s) => {
              const progress = ingestProgress.get(s.session_key)
              const isIngesting = !!progress

              if (isIngesting) {
                return (
                  <div
                    key={s.session_key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '5px 6px 5px 12px',
                      background: '#2a2a2a', border: '1px solid #555',
                      borderRadius: '4px', fontSize: '13px', color: '#aaa',
                    }}
                  >
                    <span>{s.session_name}</span>
                    <ProgressRing done={progress.done} total={progress.total} />
                    <button
                      onClick={() => handleCancel(s.session_key, progress.raceId)}
                      title="Cancel ingest"
                      style={{
                        background: 'none', border: 'none', color: '#f55',
                        cursor: 'pointer', padding: '0 2px', fontSize: '13px',
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )
              }

              if (s.ingested && s.race_id) {
                return (
                  <button
                    key={s.session_key}
                    onClick={() => onSelect(s.race_id!)}
                    style={{
                      padding: '6px 14px', cursor: 'pointer',
                      background: '#1a6e1a', color: '#fff',
                      border: '1px solid #2a9e2a', borderRadius: '4px', fontSize: '13px',
                    }}
                  >
                    {s.session_name}
                  </button>
                )
              }

              return (
                <button
                  key={s.session_key}
                  onClick={() => handleIngest(s)}
                  style={{
                    padding: '6px 14px', cursor: 'pointer',
                    background: '#333', color: '#ccc',
                    border: '1px solid #555', borderRadius: '4px', fontSize: '13px',
                  }}
                >
                  {s.session_name} ↓
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
