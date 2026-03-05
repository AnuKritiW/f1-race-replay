import { useEffect, useState } from 'react'
import { fetchTimeline } from './api/client'
import { usePlayback } from './hooks/usePlayback'
import { TrackMap } from './components/TrackMap'
import { PlaybackControls } from './components/PlaybackControls'
import { Scrubber } from './components/Scrubber'
import { SessionPicker } from './components/SessionPicker'
import type { RaceTimeline } from './types'

function ReplayPlayer({ raceId, timeline }: { raceId: string; timeline: RaceTimeline }) {
  const { bufferRef, playheadRef, playheadTime, isLoaded, isPlaying, speed, play, pause, setSpeed, scrubTo } =
    usePlayback(raceId, timeline)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px' }}>
      <h1 style={{ margin: 0 }}>F1 Race Replay — {raceId}</h1>
      {!isLoaded && <p style={{ margin: 0, fontFamily: 'monospace', color: '#888' }}>Buffering…</p>}
      <TrackMap raceId={raceId} bufferRef={bufferRef} playheadRef={playheadRef} />
      <Scrubber
        timeline={timeline}
        playheadTime={playheadTime}
        isPlaying={isPlaying}
        onScrub={scrubTo}
        onPlay={play}
      />
      <PlaybackControls
        isPlaying={isPlaying}
        speed={speed}
        onPlay={play}
        onPause={pause}
        onSetSpeed={setSpeed}
      />
    </div>
  )
}

function Replay({ raceId }: { raceId: string }) {
  const [timeline, setTimeline] = useState<RaceTimeline | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTimeline(null)
    setError(null)
    fetchTimeline(raceId)
      .then(setTimeline)
      .catch((e) => setError(e.message))
  }, [raceId])

  if (error) return <p style={{ color: '#f55' }}>Error loading race: {error}</p>
  if (!timeline) return <p style={{ fontFamily: 'monospace', color: '#888' }}>Loading race data…</p>

  return <ReplayPlayer raceId={raceId} timeline={timeline} />
}

function App() {
  const [raceId, setRaceId] = useState<string | null>(null)

  return (
    <div>
      <SessionPicker onSelect={setRaceId} />
      {raceId && <Replay raceId={raceId} />}
    </div>
  )
}

export default App
