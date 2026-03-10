import { useEffect, useState } from 'react'
import type { DriverStanding, TimingState } from '../types'
import { driverColor } from '../utils/driverColor'

const COMPOUND_COLORS: Record<string, string> = {
  SOFT: '#e8002d',
  MEDIUM: '#ffd600',
  HARD: '#ffffff',
  INTER: '#43b02a',
  WET: '#0067ff',
}

const RACE_SESSIONS = new Set(['Race', 'Sprint'])
const LAP_TIMING_SESSIONS = new Set(['Qualifying', 'Sprint Qualifying', 'Practice 1', 'Practice 2', 'Practice 3'])

function formatGap(val: number | null, isLeader: boolean): string {
  if (isLeader) return '—'
  if (val === null) return '—'
  if (val >= 1000) return `+${Math.round(val - 1000)}L`
  return `+${val.toFixed(3)}`
}

function formatLapTime(val: number | null): string {
  if (val === null) return '—'
  const mins = Math.floor(val / 60)
  const secs = (val % 60).toFixed(3).padStart(6, '0')
  return mins > 0 ? `${mins}:${secs}` : secs
}

type ViewMode = 'position' | 'fastest'

interface Props {
  timingBufferRef: React.RefObject<Map<number, TimingState>>
  playheadRef: React.RefObject<number>
  colorMap: Record<string, string>
  sessionType: string
}

export function TimingTower({ timingBufferRef, playheadRef, colorMap, sessionType }: Props) {
  const defaultView: ViewMode = RACE_SESSIONS.has(sessionType) ? 'position' : 'fastest'
  const [view, setView] = useState<ViewMode>(defaultView)
  const [showGap, setShowGap] = useState(true)
  const [standings, setStandings] = useState<DriverStanding[]>([])

  // Which views are available for this session type
  const availableViews: ViewMode[] = RACE_SESSIONS.has(sessionType)
    ? ['position']
    : LAP_TIMING_SESSIONS.has(sessionType)
      ? ['fastest']
      : ['position', 'fastest']  // unknown session type: show both

  useEffect(() => {
    const next = RACE_SESSIONS.has(sessionType) ? 'position' : 'fastest'
    setView(next)
  }, [sessionType])

  useEffect(() => {
    const id = setInterval(() => {
      const frame = timingBufferRef.current.get(Math.floor(playheadRef.current))
      if (frame) setStandings(frame.standings)
    }, 200)
    return () => clearInterval(id)
  }, [timingBufferRef, playheadRef])

  const sortByBestLap = (a: DriverStanding, b: DriverStanding) => {
    if (a.best_lap_duration === null && b.best_lap_duration === null) return 0
    if (a.best_lap_duration === null) return 1
    if (b.best_lap_duration === null) return -1
    return a.best_lap_duration - b.best_lap_duration
  }

  // For lap timing view: active drivers sorted by best lap, then Q2-eliminated, then Q1-eliminated
  const displayStandings = view === 'fastest'
    ? [
        ...standings.filter(s => s.status === 'active').sort(sortByBestLap),
        ...standings.filter(s => s.eliminated_in_phase === 2).sort(sortByBestLap),
        ...standings.filter(s => s.eliminated_in_phase === 1).sort(sortByBestLap),
      ]
    : standings

  const sessionBest = view === 'fastest'
    ? displayStandings.find(s => s.best_lap_duration !== null && s.status === 'active')?.best_lap_duration ?? null
    : null

  const hasEliminations = standings.some(s => s.status === 'eliminated')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 12px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          {availableViews.length > 1 && availableViews.map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                fontFamily: 'var(--font-data)',
                fontSize: '10px',
                letterSpacing: '1px',
                textTransform: 'uppercase',
                padding: '3px 8px',
                borderRadius: '3px',
                border: '1px solid var(--color-border)',
                cursor: 'pointer',
                background: view === v ? 'rgba(255,255,255,0.12)' : 'transparent',
                color: view === v ? 'var(--color-text)' : 'var(--color-muted)',
              }}
            >
              {v === 'position' ? 'Track Pos' : 'Lap Timing'}
            </button>
          ))}
          {availableViews.length === 1 && (
            <span style={{
              fontFamily: 'var(--font-data)',
              fontSize: '10px',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              color: 'var(--color-muted)',
            }}>
              {view === 'position' ? 'Track Pos' : 'Lap Timing'}
            </span>
          )}
          {view === 'position' && (
            <button
              onClick={() => setShowGap(g => !g)}
              style={{
                marginLeft: 'auto',
                fontFamily: 'var(--font-data)',
                fontSize: '10px',
                letterSpacing: '1px',
                padding: '3px 8px',
                borderRadius: '3px',
                border: '1px solid var(--color-border)',
                cursor: 'pointer',
                background: 'transparent',
                color: 'var(--color-muted)',
              }}
            >
              {showGap ? 'INT' : 'LEADER'}
            </button>
          )}
        </div>
        <div style={{ height: '1px', background: 'var(--color-border)' }} />
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '20px 38px 1fr 64px 46px',
        padding: '0 12px 4px',
        gap: '4px',
      }}>
        {(view === 'position'
          ? ['P', 'DRV', showGap ? 'LEADER' : 'INT', 'LAST', 'TYRE']
          : ['P', 'DRV', 'BEST', '', 'TYRE']
        ).map((h, i) => (
          <span key={i} style={{
            fontFamily: 'var(--font-data)',
            fontSize: '9px',
            color: 'var(--color-muted)',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            textAlign: 'right',
          }}>{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {displayStandings.length === 0
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{
                height: '34px',
                margin: '2px 12px',
                borderRadius: '4px',
                background: 'linear-gradient(90deg, var(--color-surface) 25%, var(--color-border) 50%, var(--color-surface) 75%)',
                backgroundSize: '200% 100%',
                animation: 'pulse 1.5s infinite',
                animationDelay: `${i * 0.15}s`,
              }} />
            ))
          : displayStandings.map((s, idx) => {
              const prevS = displayStandings[idx - 1]
              const showSeparator = view === 'fastest' && hasEliminations && idx > 0
                && s.eliminated_in_phase !== prevS?.eliminated_in_phase

              const label = s.eliminated_in_phase === 2 && prevS?.eliminated_in_phase !== 2
                ? 'Q2 Out'
                : s.eliminated_in_phase === 1 && prevS?.eliminated_in_phase !== 1
                  ? 'Q1 Out'
                  : null

              return (
                <div key={s.driver_id}>
                  {showSeparator && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '4px 12px 2px',
                    }}>
                      <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
                      {label && (
                        <span style={{
                          fontFamily: 'var(--font-data)', fontSize: '9px',
                          color: 'var(--color-muted)', letterSpacing: '1px',
                        }}>{label}</span>
                      )}
                      <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
                    </div>
                  )}
                  <DriverRow
                    standing={s}
                    rank={idx + 1}
                    isLeader={idx === 0}
                    view={view}
                    showGap={showGap}
                    sessionBest={sessionBest}
                    color={colorMap[s.driver_id] ?? driverColor(s.driver_id)}
                  />
                </div>
              )
            })
        }
      </div>
    </div>
  )
}

function DriverRow({
  standing, rank, isLeader, view, showGap, sessionBest, color,
}: {
  standing: DriverStanding
  rank: number
  isLeader: boolean
  view: ViewMode
  showGap: boolean
  sessionBest: number | null
  color: string
}) {
  const [hovered, setHovered] = useState(false)
  const { driver_id, position, gap_to_leader, interval, last_lap_duration,
          best_lap_duration, compound, tyre_age, is_fastest_lap, status } = standing

  const isEliminated = status === 'eliminated'
  const compoundColor = compound ? (COMPOUND_COLORS[compound] ?? '#888') : '#888'
  const displayPos = view === 'position' ? (position ?? rank) : rank
  const rowOpacity = isEliminated ? 0.45 : 1

  // Fastest lap: purple on the time cell
  const isFastestInView = view === 'fastest'
    ? (best_lap_duration !== null && sessionBest !== null && Math.abs(best_lap_duration - sessionBest) < 0.001)
    : is_fastest_lap

  const fastStyle: React.CSSProperties = isFastestInView
    ? { color: '#c678dd', fontWeight: 700 }
    : { color: 'var(--color-muted)' }

  const gapVal = showGap ? gap_to_leader : interval
  const timeVal = view === 'position' ? last_lap_duration : best_lap_duration

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 38px 1fr 64px 46px',
        alignItems: 'center',
        height: '34px',
        padding: '0 12px',
        gap: '4px',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        cursor: 'default',
        opacity: rowOpacity,
      }}
    >
      {/* Position */}
      <span style={{
        fontFamily: 'var(--font-data)', fontSize: '11px',
        color: 'var(--color-muted)', textAlign: 'right',
      }}>
        {displayPos}
      </span>

      {/* Driver + color dot */}
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: color, flexShrink: 0,
        }} />
        <span style={{
          fontFamily: 'var(--font-data)', fontSize: '13px', fontWeight: 700,
          color: 'var(--color-text)', letterSpacing: '0.5px',
        }}>
          {driver_id}
        </span>
      </span>

      {/* Gap / interval (position view) or empty (fastest view) */}
      <span style={{
        fontFamily: 'var(--font-data)', fontSize: '12px',
        color: 'var(--color-muted)', textAlign: 'right',
      }}>
        {view === 'position' ? formatGap(gapVal, isLeader) : ''}
      </span>

      {/* Lap time */}
      <span style={{
        fontFamily: 'var(--font-data)', fontSize: '12px',
        textAlign: 'right', ...fastStyle,
      }}>
        {formatLapTime(timeVal)}
      </span>

      {/* Tyre */}
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px' }}>
        {compound ? (
          <>
            <span style={{
              fontFamily: 'var(--font-data)', fontSize: '11px',
              fontWeight: 700, color: compoundColor,
            }}>
              {compound[0]}
            </span>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: '10px', color: 'var(--color-muted)' }}>
              {tyre_age}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--color-muted)', fontSize: '11px' }}>—</span>
        )}
      </span>
    </div>
  )
}
