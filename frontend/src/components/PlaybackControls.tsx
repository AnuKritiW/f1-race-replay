import { useState } from 'react'

type Speed = 1 | 5 | 10

interface Props {
  isPlaying: boolean
  isBuffering: boolean
  speed: Speed
  onPlay: () => void
  onPause: () => void
  onSetSpeed: (s: Speed) => void
}

const SPEEDS: Speed[] = [1, 5, 10]

export function PlaybackControls({ isPlaying, isBuffering, speed, onPlay, onPause, onSetSpeed }: Props) {
  const [playHovered, setPlayHovered] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 0', gap: '8px', position: 'relative' }}>
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
          onClick={isBuffering ? undefined : (isPlaying ? onPause : onPlay)}
          onMouseEnter={() => !isBuffering && setPlayHovered(true)}
          onMouseLeave={() => setPlayHovered(false)}
          style={{
            background: playHovered && !isBuffering ? 'rgba(255,255,255,0.08)' : 'transparent',
            border: 'none',
            color: 'var(--color-text)',
            padding: '4px 10px',
            borderRadius: '999px',
            fontSize: '14px',
            cursor: isBuffering ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '32px',
          }}
        >
          {isBuffering ? (
            <span style={{
              display: 'inline-block',
              width: '13px',
              height: '13px',
              border: '2px solid rgba(255,255,255,0.25)',
              borderTopColor: 'var(--color-text)',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }} />
          ) : (isPlaying ? '⏸' : '▶')}
        </button>
        <div style={{ width: '1px', height: '20px', background: 'var(--color-border)', flexShrink: 0 }} />
        {SPEEDS.map((s) => (
          <SpeedButton key={s} value={s} active={speed === s} onClick={() => onSetSpeed(s)} />
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowHelp((v) => !v)}
          style={{
            background: showHelp ? 'rgba(255,255,255,0.08)' : 'transparent',
            border: '1px solid var(--color-border)',
            color: 'var(--color-muted)',
            borderRadius: '999px',
            width: '24px',
            height: '24px',
            fontSize: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          ?
        </button>
        {showHelp && (
          <div style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            right: 0,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            padding: '10px 14px',
            whiteSpace: 'nowrap',
            zIndex: 100,
          }}>
            {([
              ['Space', 'Play / Pause'],
              ['← →', 'Scrub ±10s'],
              ['[', 'Slower'],
              [']', 'Faster'],
            ] as [string, string][]).map(([key, desc]) => (
              <div key={key} style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '3px 0' }}>
                <kbd style={{
                  fontFamily: 'var(--font-data)',
                  fontSize: '11px',
                  color: 'var(--color-text)',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '4px',
                  padding: '1px 6px',
                  minWidth: '36px',
                  textAlign: 'center',
                  display: 'inline-block',
                }}>
                  {key}
                </kbd>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: '12px', color: 'var(--color-muted)' }}>
                  {desc}
                </span>
              </div>
            ))}
          </div>
        )}
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
