import { useRef } from 'react'
import type { RaceTimeline } from '../types'

interface Props {
  timeline: RaceTimeline
  playheadTime: number
  isPlaying: boolean
  onScrub: (t: number) => void
  onPlay: () => void
}

function formatRaceTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function Scrubber({ timeline, playheadTime, isPlaying, onScrub, onPlay }: Props) {
  const wasPlayingRef = useRef(false)

  const relativeSeconds = playheadTime - timeline.start_time

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontFamily: 'monospace', minWidth: '5ch' }}>
        {formatRaceTime(relativeSeconds)}
      </span>
      <input
        type="range"
        min={timeline.start_time}
        max={timeline.end_time}
        step={1}
        value={playheadTime}
        onMouseDown={() => { wasPlayingRef.current = isPlaying }}
        onTouchStart={() => { wasPlayingRef.current = isPlaying }}
        onChange={(e) => onScrub(Number(e.target.value))}
        onMouseUp={() => { if (wasPlayingRef.current) onPlay() }}
        onTouchEnd={() => { if (wasPlayingRef.current) onPlay() }}
        style={{ flex: 1 }}
      />
    </div>
  )
}
