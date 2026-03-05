import { useEffect, useState } from 'react'
import { fetchTimeline } from './api/client'
import type { RaceTimeline } from './types'

const RACE_ID = 'bahrain-2024'

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

  return (
    <div>
      <h1>F1 Race Replay — {RACE_ID}</h1>
      <p>Start: {new Date(timeline.start_time * 1000).toUTCString()}</p>
      <p>End: {new Date(timeline.end_time * 1000).toUTCString()}</p>
      <p>Duration: {(timeline.duration / 60).toFixed(1)} minutes</p>
    </div>
  )
}

export default App
