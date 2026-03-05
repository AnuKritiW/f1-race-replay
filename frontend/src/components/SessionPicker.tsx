import { useEffect, useRef, useState } from 'react'
import { fetchAvailableSessions, fetchSessions, postIngest } from '../api/client'
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

export function SessionPicker({ onSelect }: Props) {
  const [year, setYear] = useState(2024)
  const [sessions, setSessions] = useState<AvailableSession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ingesting, setIngesting] = useState<Set<number>>(new Set())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchAvailableSessions(year)
      .then(setSessions)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [year])

  function stopPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  async function handleIngest(session: AvailableSession) {
    const raceId = generateRaceId(session)
    setIngesting((prev) => new Set(prev).add(session.session_key))

    try {
      await postIngest(raceId, session.session_key)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      // 409 means already ingested — just start polling
      if (!msg.includes('409')) {
        setIngesting((prev) => { const s = new Set(prev); s.delete(session.session_key); return s })
        setError(`Ingest failed: ${msg}`)
        return
      }
    }

    // Poll until the new race_id appears in /sessions
    pollRef.current = setInterval(async () => {
      try {
        const ingested = await fetchSessions()
        if (ingested.some((s) => s.race_id === raceId)) {
          stopPoll()
          setSessions((prev) =>
            prev.map((s) =>
              s.session_key === session.session_key
                ? { ...s, ingested: true, race_id: raceId }
                : s
            )
          )
          setIngesting((prev) => { const next = new Set(prev); next.delete(session.session_key); return next })
        }
      } catch {
        // ignore poll errors
      }
    }, 3000)
  }

  useEffect(() => () => stopPoll(), [])

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
              const isIngesting = ingesting.has(s.session_key)
              if (s.ingested && s.race_id) {
                return (
                  <button
                    key={s.session_key}
                    onClick={() => onSelect(s.race_id!)}
                    style={{
                      padding: '6px 14px',
                      cursor: 'pointer',
                      background: '#1a6e1a',
                      color: '#fff',
                      border: '1px solid #2a9e2a',
                      borderRadius: '4px',
                      fontSize: '13px',
                    }}
                  >
                    {s.session_name}
                  </button>
                )
              }
              return (
                <button
                  key={s.session_key}
                  onClick={() => !isIngesting && handleIngest(s)}
                  disabled={isIngesting}
                  style={{
                    padding: '6px 14px',
                    cursor: isIngesting ? 'wait' : 'pointer',
                    background: '#333',
                    color: isIngesting ? '#888' : '#ccc',
                    border: '1px solid #555',
                    borderRadius: '4px',
                    fontSize: '13px',
                  }}
                >
                  {s.session_name} {isIngesting ? '(ingesting…)' : '↓ Ingest'}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
