import { useEffect, useState } from 'react'
import { fetchTimeline } from './api/client'
import { usePlayback } from './hooks/usePlayback'
import { TrackMap } from './components/TrackMap'
import { PlaybackControls } from './components/PlaybackControls'
import { Scrubber } from './components/Scrubber'
import type { RaceTimeline } from './types'

const RACE_ID = 'singapore-2023-p1'

function Replay({ timeline }: { timeline: RaceTimeline }) {
  const { raceState, playheadTime, isPlaying, speed, play, pause, setSpeed, scrubTo } =
    usePlayback(RACE_ID, timeline)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px' }}>
      <h1 style={{ margin: 0 }}>F1 Race Replay — {RACE_ID}</h1>
      <TrackMap raceId={RACE_ID} raceState={raceState} />
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

function App() {
  const [timeline, setTimeline] = useState<RaceTimeline | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTimeline(RACE_ID)
      .then(setTimeline)
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <p>Error: {error}</p>
  if (!timeline) return <p>Loading...</p>

  return <Replay timeline={timeline} />
}

export default App
