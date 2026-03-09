import { useState } from 'react'

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
  const [playHovered, setPlayHovered] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 0' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: '999px',
        padding: '4px 8px',
        gap: '4px',
      }}>
        <button
          onClick={isPlaying ? onPause : onPlay}
          onMouseEnter={() => setPlayHovered(true)}
          onMouseLeave={() => setPlayHovered(false)}
          style={{
            background: playHovered ? 'rgba(255,255,255,0.08)' : 'transparent',
            border: 'none',
            color: 'var(--color-text)',
            padding: '4px 10px',
            borderRadius: '999px',
            fontSize: '14px',
          }}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <div style={{ width: '1px', height: '20px', background: 'var(--color-border)', flexShrink: 0 }} />
        {SPEEDS.map((s) => (
          <SpeedButton key={s} value={s} active={speed === s} onClick={() => onSetSpeed(s)} />
        ))}
      </div>
      <div style={{
        textAlign: 'center',
        marginTop: '4px',
        fontSize: '11px',
        color: 'var(--color-muted)',
        fontFamily: 'var(--font-data)',
        letterSpacing: '0.5px',
      }}>
        SPACE · ← → · [ ]
      </div>
    </div>
  )
}

function SpeedButton({ value, active, onClick }: { value: Speed; active: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: active ? 'var(--color-accent)' : hovered ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: active ? '#fff' : hovered ? 'var(--color-text)' : 'var(--color-muted)',
        border: 'none',
        borderRadius: '999px',
        padding: '4px 10px',
        fontSize: '13px',
        fontFamily: 'var(--font-data)',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
      }}
    >
      {value}×
    </button>
  )
}
