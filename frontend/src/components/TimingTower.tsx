import { useEffect, useState } from 'react'
import type { RaceState } from '../types'
import { driverColor } from '../utils/driverColor'

interface Props {
  bufferRef: React.RefObject<Map<number, RaceState>>
  playheadRef: React.RefObject<number>
  colorMap: Record<string, string>
}

interface DriverEntry {
  id: string
  speed: number | null
}

export function TimingTower({ bufferRef, playheadRef, colorMap }: Props) {
  const [drivers, setDrivers] = useState<DriverEntry[]>([])

  useEffect(() => {
    const id = setInterval(() => {
      const state = bufferRef.current.get(Math.floor(playheadRef.current))
      if (!state) return
      const list = Object.entries(state.cars)
        .filter(([, c]) => c.x !== 0 || c.y !== 0)
        .map(([id, c]) => ({ id, speed: c.speed ?? null }))
        .sort((a, b) => (b.speed ?? -1) - (a.speed ?? -1))
      setDrivers(list)
    }, 200)
    return () => clearInterval(id)
  }, [bufferRef, playheadRef])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '12px 12px 8px' }}>
        <div style={{
          fontFamily: 'var(--font-data)',
          fontSize: '11px',
          color: 'var(--color-muted)',
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          marginBottom: '8px',
        }}>
          Timing
        </div>
        <div style={{ height: '1px', background: 'var(--color-border)' }} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {drivers.length === 0
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{
                height: '34px',
                margin: '2px 12px',
                borderRadius: '4px',
                background: 'linear-gradient(90deg, var(--color-surface) 25%, var(--color-border) 50%, var(--color-surface) 75%)',
                backgroundSize: '200% 100%',
                animation: 'pulse 1.5s infinite',
                animationDelay: `${i * 0.15}s`,
              }} />
            ))
          : drivers.map(({ id, speed }) => (
              <DriverRow key={id} id={id} speed={speed} color={colorMap[id] ?? driverColor(id)} />
            ))
        }
      </div>
    </div>
  )
}

function DriverRow({ id, speed, color }: { id: string; speed: number | null; color: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '34px',
        padding: '0 12px',
        gap: '8px',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        cursor: 'default',
      }}
    >
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }} />
      <span style={{
        fontFamily: 'var(--font-data)',
        fontSize: '14px',
        fontWeight: 700,
        flex: 1,
        color: 'var(--color-text)',
        letterSpacing: '0.5px',
      }}>
        {id}
      </span>
      <span style={{
        fontFamily: 'var(--font-data)',
        fontSize: '13px',
        color: 'var(--color-muted)',
        minWidth: '3ch',
        textAlign: 'right',
      }}>
        {speed != null ? Math.round(speed) : '—'}
      </span>
    </div>
  )
}
