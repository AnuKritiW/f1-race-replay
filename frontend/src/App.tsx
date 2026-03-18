import { useEffect, useRef, useState } from 'react'
import { fetchDriverColors, fetchSessions, fetchTimeline } from './api/client'
import { usePlayback } from './hooks/usePlayback'
import { TrackMap } from './components/TrackMap'
import { PlaybackControls } from './components/PlaybackControls'
import { Scrubber } from './components/Scrubber'
import { SessionPicker } from './components/SessionPicker'
import { TimingTower } from './components/TimingTower'
import type { SessionInfo, RaceTimeline } from './types'

type Speed = 1 | 5 | 10
const SPEED_LIST: Speed[] = [1, 5, 10]

// Parse raceId from the current pathname, e.g. /replay/singapore-2023-p1
function parseRoute(): string | null {
  const m = window.location.pathname.match(/^\/replay\/(.+)$/)
  return m ? m[1] : null
}

function AppHeader({
  sessionInfo,
  onBack,
}: {
  sessionInfo: SessionInfo | null
  onBack?: () => void
}) {
  return (
    <header style={{
      height: '48px',
      flexShrink: 0,
      background: 'var(--color-surface)',
      borderBottom: '1px solid var(--color-border)',
      borderLeft: '3px solid var(--color-accent)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: '16px',
    }}>
      <span style={{
        fontFamily: 'var(--font-data)',
        fontWeight: 600,
        fontSize: '18px',
        color: 'var(--color-accent)',
        letterSpacing: '1px',
      }}>
        F1 REPLAY
      </span>
      {sessionInfo && (
        <span style={{
          fontFamily: 'var(--font-data)',
          color: 'var(--color-muted)',
          fontSize: '15px',
        }}>
          {sessionInfo.event_name} · {sessionInfo.session_name}
        </span>
      )}
      {onBack && (
        <button
          onClick={onBack}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: '1px solid var(--color-border)',
            color: 'var(--color-muted)',
            borderRadius: '4px',
            padding: '4px 10px',
            fontSize: '12px',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.6' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
        >
          ← Sessions
        </button>
      )}
      {/* LIVE indicator — reserved for future live data feature */}
    </header>
  )
}

function ReplayPlayer({
  raceId,
  timeline,
  sessionInfo,
  sessionType,
  onBack,
}: {
  raceId: string
  timeline: RaceTimeline
  sessionInfo: SessionInfo | null
  sessionType: string
  onBack: () => void
}) {
  const { bufferRef, timingBufferRef, scrubBufferRef, playheadRef, playheadTime, isLoaded, isPlaying, isBuffering, loadedRanges, speed, play, pause, setSpeed, scrubTo, onScrubSettle } =
    usePlayback(raceId, timeline)

  const [colorMap, setColorMap] = useState<Record<string, string>>({})
  useEffect(() => {
    fetchDriverColors(raceId).then(setColorMap).catch(() => {})
  }, [raceId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
      if (e.code === 'Space') {
        e.preventDefault()
        isPlaying ? pause() : play()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        scrubTo(playheadTime - 10)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        scrubTo(playheadTime + 10)
      } else if (e.key === '[') {
        const i = SPEED_LIST.indexOf(speed)
        if (i > 0) setSpeed(SPEED_LIST[i - 1])
      } else if (e.key === ']') {
        const i = SPEED_LIST.indexOf(speed)
        if (i < SPEED_LIST.length - 1) setSpeed(SPEED_LIST[i + 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isPlaying, play, pause, scrubTo, setSpeed, speed, playheadTime])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppHeader sessionInfo={sessionInfo} onBack={onBack} />
      {!isLoaded && (
        <div style={{
          height: '3px',
          flexShrink: 0,
          background: 'linear-gradient(90deg, transparent, var(--color-accent), transparent)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.2s linear infinite',
        }} />
      )}
      <main style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <aside style={{
          width: '280px',
          flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <TimingTower timingBufferRef={timingBufferRef} scrubBufferRef={scrubBufferRef} playheadRef={playheadRef} colorMap={colorMap} sessionType={sessionType} totalLaps={timeline.total_laps ?? null} />
        </aside>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <TrackMap raceId={raceId} bufferRef={bufferRef} timingBufferRef={timingBufferRef} scrubBufferRef={scrubBufferRef} playheadRef={playheadRef} colorMap={colorMap} />
        </div>
      </main>
      <footer style={{
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-border)',
        padding: '8px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        flexShrink: 0,
      }}>
        <Scrubber
          timeline={timeline}
          playheadTime={playheadTime}
          isPlaying={isPlaying}
          onScrub={scrubTo}
          onPlay={play}
          onScrubSettle={onScrubSettle}
          loadedRanges={loadedRanges}
        />
        <PlaybackControls
          isPlaying={isPlaying}
          isBuffering={isBuffering}
          speed={speed}
          onPlay={play}
          onPause={pause}
          onSetSpeed={setSpeed}
        />
      </footer>
    </div>
  )
}

function Replay({
  raceId,
  sessionInfo,
  onBack,
}: {
  raceId: string
  sessionInfo: SessionInfo | null
  onBack: () => void
}) {
  const [timeline, setTimeline] = useState<RaceTimeline | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sessionType, setSessionType] = useState<string>(sessionInfo?.session_type ?? '')

  useEffect(() => {
    setTimeline(null)
    setError(null)
    fetchTimeline(raceId)
      .then(setTimeline)
      .catch((e: Error) => setError(e.message))
  }, [raceId])

  // Derive sessionType for direct URL loads where sessionInfo is null
  useEffect(() => {
    if (sessionInfo) {
      setSessionType(sessionInfo.session_type)
    } else {
      fetchSessions()
        .then(sessions => {
          const found = sessions.find(s => s.race_id === raceId)
          if (found) setSessionType(found.session_type)
        })
        .catch(() => {})
    }
  }, [raceId, sessionInfo])

  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppHeader sessionInfo={sessionInfo} onBack={onBack} />
      <p style={{ color: '#f55', padding: '16px' }}>Error loading race: {error}</p>
    </div>
  )

  if (!timeline) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppHeader sessionInfo={sessionInfo} onBack={onBack} />
      <div style={{
        height: '3px',
        flexShrink: 0,
        background: 'linear-gradient(90deg, transparent, var(--color-accent), transparent)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.2s linear infinite',
      }} />
    </div>
  )

  return <ReplayPlayer raceId={raceId} timeline={timeline} sessionInfo={sessionInfo} sessionType={sessionType} onBack={onBack} />
}

function App() {
  // Initialise from URL so a page refresh restores the current session
  const [raceId, setRaceId] = useState<string | null>(parseRoute)
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null)

  // Lifted so year selection survives navigating to replay and back
  const [year, setYear] = useState(2024)
  // Saves the scroll position of the session picker before navigating away
  const scrollYRef = useRef(0)

  // Handle browser back/forward button
  useEffect(() => {
    function onPopState() {
      setRaceId(parseRoute())
      setSelectedSession(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function handleSelect(id: string, session: SessionInfo) {
    scrollYRef.current = window.scrollY
    const debug = window.location.search.includes('rotateDebug') ? window.location.search : ''
    window.history.pushState({}, '', `/replay/${id}${debug}`)
    setRaceId(id)
    setSelectedSession(session)
  }

  function handleBack() {
    const debug = window.location.search.includes('rotateDebug') ? window.location.search : ''
    window.history.pushState({}, '', `/${debug}`)
    setRaceId(null)
    setSelectedSession(null)
  }

  if (!raceId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <AppHeader sessionInfo={null} />
        <SessionPicker
          onSelect={handleSelect}
          year={year}
          onYearChange={setYear}
          scrollYRef={scrollYRef}
        />
      </div>
    )
  }

  return <Replay raceId={raceId} sessionInfo={selectedSession} onBack={handleBack} />
}

export default App
