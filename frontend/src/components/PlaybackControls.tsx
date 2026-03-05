type Speed = 1 | 5 | 10

interface Props {
  isPlaying: boolean
  speed: Speed
  onPlay: () => void
  onPause: () => void
  onSetSpeed: (s: Speed) => void
}

const SPEEDS: Speed[] = [1, 5, 10]

export function PlaybackControls({ isPlaying, speed, onPlay, onPause, onSetSpeed }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <button onClick={isPlaying ? onPause : onPlay}>
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <div style={{ display: 'flex', gap: '4px' }}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSetSpeed(s)}
            style={{
              fontWeight: speed === s ? 'bold' : 'normal',
              textDecoration: speed === s ? 'underline' : 'none',
              opacity: speed === s ? 1 : 0.6,
            }}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  )
}
