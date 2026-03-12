import { useRef } from 'react'
import type { RaceTimeline } from '../types'

interface Props {
  timeline: RaceTimeline
  playheadTime: number
  isPlaying: boolean
  onScrub: (t: number) => void
  onPlay: () => void
  onScrubSettle: (t: number) => void
  loadedRanges: [number, number][]
}

function formatRaceTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function Scrubber({ timeline, playheadTime, isPlaying, onScrub, onPlay, onScrubSettle, loadedRanges = [] }: Props) {
  const wasPlayingRef = useRef(false)

  const relativeSeconds = playheadTime - timeline.start_time
  const pct = timeline.duration > 0
    ? ((playheadTime - timeline.start_time) / timeline.duration) * 100
    : 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontFamily: 'var(--font-data)', minWidth: '5ch', fontSize: '14px' }}>
        {formatRaceTime(relativeSeconds)}
      </span>
      <div style={{ flex: 1, position: 'relative' }}>
        <input
          type="range"
          min={timeline.start_time}
          max={timeline.end_time}
          step={1}
          value={playheadTime}
          onMouseDown={() => { wasPlayingRef.current = isPlaying }}
          onTouchStart={() => { wasPlayingRef.current = isPlaying }}
          onChange={(e) => onScrub(Number(e.target.value))}
          onMouseUp={(e) => {
            onScrubSettle(Number((e.currentTarget as HTMLInputElement).value))
            if (wasPlayingRef.current) onPlay()
          }}
          onTouchEnd={(e) => {
            onScrubSettle(Number((e.currentTarget as HTMLInputElement).value))
            if (wasPlayingRef.current) onPlay()
          }}
          style={{ width: '100%', '--range-pct': `${pct}%` } as React.CSSProperties}
        />
        {timeline.duration > 0 && (loadedRanges ?? []).map(([from, to]) => {
          const left = Math.max(0, (from - timeline.start_time) / timeline.duration * 100)
          const width = Math.min(100 - left, (to - from) / timeline.duration * 100)
          return (
            <div
              key={from}
              style={{
                position: 'absolute',
                left: `${left}%`,
                width: `${width}%`,
                height: '4px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.18)',
                borderRadius: '2px',
                pointerEvents: 'none',
              }}
            />
          )
        })}
      </div>
      <span style={{
        fontFamily: 'var(--font-data)',
        minWidth: '5ch',
        fontSize: '14px',
        color: 'var(--color-muted)',
        textAlign: 'right',
      }}>
        {formatRaceTime(timeline.duration)}
      </span>
    </div>
  )
}
