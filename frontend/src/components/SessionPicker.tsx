import { useEffect, useRef, useState } from 'react'
import { fetchSessions } from '../api/client'
import type { SessionInfo } from '../types'

interface Props {
  onSelect: (raceId: string, session: SessionInfo) => void
  year: number
  onYearChange: (y: number) => void
  scrollYRef: React.RefObject<number>
}

function cityFromRaceId(raceId: string): string {
  const city = raceId.replace(/-\d{4}-.+$/, '')
  return city.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}

function groupByEvent(sessions: SessionInfo[]): Map<string, SessionInfo[]> {
  const map = new Map<string, SessionInfo[]>()
  for (const s of sessions) {
    const key = cityFromRaceId(s.race_id)
    const arr = map.get(key) ?? []
    arr.push(s)
    map.set(key, arr)
  }
  return map
}

function SessionChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: '28px',
        padding: '4px 10px',
        border: '1px solid #10b981',
        borderRadius: '4px',
        background: 'rgba(16,185,129,0.15)',
        color: '#10b981',
        fontSize: '13px',
        fontFamily: 'var(--font-data)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(16,185,129,0.28)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(16,185,129,0.15)' }}
    >
      {label}
    </button>
  )
}

interface EventCardProps {
  name: string
  sessions: SessionInfo[]
  year: number
  onSelect: (raceId: string, session: SessionInfo) => void
}

function EventCard({ name, sessions, year, onSelect }: EventCardProps) {
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
      <div style={{
        fontFamily: 'var(--font-data)',
        fontSize: '12px',
        color: 'var(--color-muted)',
        marginBottom: '12px',
        display: 'flex',
        gap: '8px',
      }}>
        {country && <span>{country}</span>}
        {sessions[0]?.date_start && (
          <span>{new Date(sessions[0].date_start).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span>
        )}
      </div>
      <div style={{ height: '1px', background: 'var(--color-border)', marginBottom: '12px' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {sessions.map((s) => (
          <SessionChip
            key={s.session_key}
            label={s.session_name}
            onClick={() => onSelect(s.race_id, s)}
          />
        ))}
      </div>
    </div>
  )
}

export function SessionPicker({ onSelect, year, onYearChange, scrollYRef }: Props) {
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scrollRestoredRef = useRef(false)
  useEffect(() => {
    if (!loading && allSessions.length > 0 && !scrollRestoredRef.current) {
      scrollRestoredRef.current = true
      window.scrollTo(0, scrollYRef.current)
    }
  }, [loading, allSessions, scrollYRef])

  useEffect(() => {
    let ignore = false
    setLoading(true)
    setError(null)
    fetchSessions()
      .then((data) => { if (!ignore) setAllSessions(data) })
      .catch((e) => { if (!ignore) setError(e.message) })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [])

  const years = Array.from(new Set(allSessions.map((s) => s.year))).sort((a, b) => b - a)
  const sessions = allSessions.filter((s) => s.year === year)
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
          {years.map((y) => (
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
                onSelect={onSelect}
              />
            ))
        }
      </div>
    </div>
  )
}
