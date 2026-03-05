import { useEffect, useState } from 'react'
import { fetchTimeline } from './api/client'
import { usePlayback } from './hooks/usePlayback'
import { TrackMap } from './components/TrackMap'
import type { RaceTimeline } from './types'

const RACE_ID = 'singapore-2023-p1'

function Replay({ timeline }: { timeline: RaceTimeline }) {
  const { raceState, playheadTime, isPlaying, speed, play, pause, setSpeed, scrubTo } =
    usePlayback(RACE_ID, timeline)

  useEffect(() => {
    if (raceState) console.log('raceState', raceState)
  }, [raceState])

  return (
    <div>
      <h1>F1 Race Replay — {RACE_ID}</h1>
      <p>Start: {new Date(timeline.start_time * 1000).toUTCString()}</p>
      <p>End: {new Date(timeline.end_time * 1000).toUTCString()}</p>
      <p>Duration: {(timeline.duration / 60).toFixed(1)} minutes</p>
      <hr />
      <p>Playhead: {new Date(playheadTime * 1000).toUTCString()}</p>
      <p>Playing: {isPlaying ? 'yes' : 'no'} | Speed: {speed}x</p>
      <button onClick={isPlaying ? pause : play}>{isPlaying ? 'Pause' : 'Play'}</button>
      {([1, 5, 10] as const).map((s) => (
        <button key={s} onClick={() => setSpeed(s)} disabled={speed === s}>{s}x</button>
      ))}
      <br />
      <input
        type="range"
        min={timeline.start_time}
        max={timeline.end_time}
        step={1}
        value={playheadTime}
        onChange={(e) => scrubTo(Number(e.target.value))}
        style={{ width: '100%' }}
      />
      <TrackMap raceId={RACE_ID} raceState={raceState} />
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
