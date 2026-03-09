import { useEffect, useRef, useState } from 'react'
import { cancelIngest, fetchAvailableSessions, fetchIngestProgress, postIngest } from '../api/client'
import type { AvailableSession } from '../types'

interface Props {
  onSelect: (raceId: string, session: AvailableSession) => void
  year: number
  onYearChange: (y: number) => void
  scrollYRef: React.RefObject<number>
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

interface EventCardProps {
  name: string
  sessions: AvailableSession[]
  year: number
  ingestProgress: Map<number, IngestProgress>
  onIngest: (session: AvailableSession) => void
  onCancel: (sessionKey: number, raceId: string) => void
  onSelect: (raceId: string, session: AvailableSession) => void
}

function EventCard({ name, sessions, year, ingestProgress, onIngest, onCancel, onSelect }: EventCardProps) {
  const country = sessions[0]?.country_name ?? ''

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: '8px',
      padding: '16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
        <span style={{
          fontFamily: 'var(--font-data)',
          fontSize: '15px',
          fontWeight: 600,
          color: 'var(--color-text)',
          lineHeight: 1.3,
        }}>
          {name}
        </span>
        <span style={{
          fontFamily: 'var(--font-data)',
          fontSize: '12px',
          color: 'var(--color-muted)',
          background: 'rgba(255,255,255,0.06)',
          padding: '2px 6px',
          borderRadius: '3px',
          flexShrink: 0,
          marginLeft: '8px',
        }}>
          {year}
        </span>
      </div>
      {country && (
        <div style={{
          fontFamily: 'var(--font-data)',
          fontSize: '12px',
          color: 'var(--color-muted)',
          marginBottom: '12px',
        }}>
          {country}
        </div>
      )}
      <div style={{ height: '1px', background: 'var(--color-border)', marginBottom: '12px' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {sessions.map((s) => {
          const progress = ingestProgress.get(s.session_key)
          const isIngesting = !!progress

          if (isIngesting) {
            return (
              <div
                key={s.session_key}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '4px 6px 4px 10px',
                  background: 'transparent',
                  border: '1px solid #555',
                  borderRadius: '4px',
                  fontSize: '13px',
                  fontFamily: 'var(--font-data)',
                  color: 'var(--color-muted)',
                }}
              >
                <span>{s.session_name}</span>
                <ProgressRing done={progress.done} total={progress.total} />
                <button
                  onClick={() => onCancel(s.session_key, progress.raceId)}
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
              <SessionChip
                key={s.session_key}
                label={s.session_name}
                variant="ingested"
                onClick={() => onSelect(s.race_id!, s)}
              />
            )
          }

          return (
            <SessionChip
              key={s.session_key}
              label={`${s.session_name} ↓`}
              variant="available"
              onClick={() => onIngest(s)}
            />
          )
        })}
      </div>
    </div>
  )
}

function SessionChip({
  label,
  variant,
  onClick,
}: {
  label: string
  variant: 'ingested' | 'available'
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)

  const base: React.CSSProperties = {
    height: '28px',
    padding: '4px 10px',
    border: 'none',
    borderRadius: '4px',
    fontSize: '13px',
    fontFamily: 'var(--font-data)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
  }

  const ingested: React.CSSProperties = {
    background: 'rgba(16,185,129,0.15)',
    border: '1px solid #10b981',
    color: '#10b981',
  }

  const available: React.CSSProperties = {
    background: 'transparent',
    border: `1px solid ${hovered ? 'var(--color-accent)' : '#444'}`,
    color: hovered ? 'var(--color-text)' : 'var(--color-muted)',
  }

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...base, ...(variant === 'ingested' ? ingested : available) }}
    >
      {label}
    </button>
  )
}

export function SessionPicker({ onSelect, year, onYearChange, scrollYRef }: Props) {
  const [sessions, setSessions] = useState<AvailableSession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ingestProgress, setIngestProgress] = useState<Map<number, IngestProgress>>(new Map())
  const pollRefs = useRef<Map<number, ReturnType<typeof setInterval>>>(new Map())

  // Restore scroll position after sessions have loaded (page must be tall enough first)
  const scrollRestoredRef = useRef(false)
  useEffect(() => {
    if (!loading && sessions.length > 0 && !scrollRestoredRef.current) {
      scrollRestoredRef.current = true
      window.scrollTo(0, scrollYRef.current)
    }
  }, [loading, sessions, scrollYRef])

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
    <div style={{ padding: '32px', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{
          fontFamily: 'var(--font-data)',
          fontSize: '28px',
          fontWeight: 600,
          letterSpacing: '2px',
          margin: 0,
          color: 'var(--color-text)',
        }}>
          SELECT SESSION
        </h1>
        <div style={{ display: 'flex', gap: '4px' }}>
          {YEARS.map((y) => (
            <button
              key={y}
              onClick={() => onYearChange(y)}
              style={{
                padding: '6px 16px',
                border: 'none',
                borderRadius: '4px',
                background: year === y ? 'var(--color-accent)' : 'transparent',
                color: year === y ? '#fff' : 'var(--color-muted)',
                fontFamily: 'var(--font-data)',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{
          borderLeft: '3px solid var(--color-accent)',
          padding: '10px 14px',
          background: 'rgba(225,6,0,0.08)',
          borderRadius: '4px',
          color: '#f88',
          fontSize: '14px',
          marginBottom: '16px',
        }}>
          {error}
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <p style={{ color: 'var(--color-muted)' }}>No sessions found for {year}.</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{
                height: '140px',
                borderRadius: '8px',
                background: 'linear-gradient(90deg, var(--color-surface) 25%, var(--color-border) 50%, var(--color-surface) 75%)',
                backgroundSize: '200% 100%',
                animation: 'pulse 1.5s infinite',
                animationDelay: `${i * 0.15}s`,
              }} />
            ))
          : Array.from(grouped.entries()).map(([eventName, eventSessions]) => (
              <EventCard
                key={eventName}
                name={eventName}
                sessions={eventSessions}
                year={year}
                ingestProgress={ingestProgress}
                onIngest={handleIngest}
                onCancel={handleCancel}
                onSelect={onSelect}
              />
            ))
        }
      </div>
    </div>
  )
}
