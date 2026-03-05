import { useEffect, useRef, useState } from 'react'
import { fetchTrack } from '../api/client'
import type { RaceState } from '../types'

interface Props {
  raceId: string
  raceState: RaceState | null
}

const CANVAS_W = 800
const CANVAS_H = 600
const PADDING = 40
const CAR_RADIUS = 8

// Deterministic color per driver abbreviation
function driverColor(driverId: string): string {
  let hash = 0
  for (let i = 0; i < driverId.length; i++) {
    hash = driverId.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 90%, 55%)`
}

interface Normalizer {
  toCanvas: (x: number, y: number) => [number, number]
}

function buildNormalizer(points: Array<{ x: number; y: number }>): Normalizer {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const drawW = CANVAS_W - PADDING * 2
  const drawH = CANVAS_H - PADDING * 2
  const scaleX = drawW / (maxX - minX)
  const scaleY = drawH / (maxY - minY)
  const scale = Math.min(scaleX, scaleY)

  // Center within canvas
  const offsetX = PADDING + (drawW - (maxX - minX) * scale) / 2
  const offsetY = PADDING + (drawH - (maxY - minY) * scale) / 2

  return {
    toCanvas: (x, y) => [
      offsetX + (x - minX) * scale,
      offsetY + (maxY - y) * scale,
    ],
  }
}

export function TrackMap({ raceId, raceState }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [trackPoints, setTrackPoints] = useState<Array<{ x: number; y: number }>>([])
  const normRef = useRef<Normalizer | null>(null)

  useEffect(() => {
    fetchTrack(raceId).then((points) => {
      setTrackPoints(points)
      normRef.current = buildNormalizer(points)
    })
  }, [raceId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !normRef.current) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const norm = normRef.current

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

    // Draw track polyline
    if (trackPoints.length > 1) {
      ctx.beginPath()
      ctx.strokeStyle = '#888'
      ctx.lineWidth = 2
      const [x0, y0] = norm.toCanvas(trackPoints[0].x, trackPoints[0].y)
      ctx.moveTo(x0, y0)
      for (let i = 1; i < trackPoints.length; i++) {
        const [x, y] = norm.toCanvas(trackPoints[i].x, trackPoints[i].y)
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // Draw cars
    if (!raceState) return
    for (const [driverId, car] of Object.entries(raceState.cars)) {
      if (car.x == null || car.y == null || (car.x === 0 && car.y === 0)) continue
      const [cx, cy] = norm.toCanvas(car.x, car.y)
      const color = driverColor(driverId)

      ctx.beginPath()
      ctx.arc(cx, cy, CAR_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()

      ctx.fillStyle = '#fff'
      ctx.font = 'bold 10px monospace'
      ctx.fillText(driverId, cx + CAR_RADIUS + 2, cy + 4)
    }
  }, [raceState, trackPoints])

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      style={{ background: '#1a1a1a', display: 'block' }}
    />
  )
}
