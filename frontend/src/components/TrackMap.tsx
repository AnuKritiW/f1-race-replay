import { useEffect, useRef, useState } from 'react'
import { fetchTrack } from '../api/client'
import type { RaceState } from '../types'

interface Props {
  raceId: string
  bufferRef: React.RefObject<Map<number, RaceState>>
  playheadRef: React.RefObject<number>
}

const CANVAS_W = 800
const CANVAS_H = 600
const PADDING = 40
const CAR_RADIUS = 8

// Catmull-Rom spline: interpolate between p1 and p2 using p0 and p3 as tangent guides
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  )
}

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

  const offsetX = PADDING + (drawW - (maxX - minX) * scale) / 2
  const offsetY = PADDING + (drawH - (maxY - minY) * scale) / 2

  return {
    toCanvas: (x, y) => [
      offsetX + (x - minX) * scale,
      offsetY + (maxY - y) * scale,
    ],
  }
}

export function TrackMap({ raceId, bufferRef, playheadRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [trackPoints, setTrackPoints] = useState<Array<{ x: number; y: number }>>([])
  const normRef = useRef<Normalizer | null>(null)

  useEffect(() => {
    fetchTrack(raceId).then((points) => {
      setTrackPoints(points)
      normRef.current = buildNormalizer(points)
    })
  }, [raceId])

  // Dedicated rAF loop — runs at 60fps independent of React renders
  useEffect(() => {
    if (trackPoints.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return

    let rafId: number

    function draw() {
      rafId = requestAnimationFrame(draw)

      const ctx = canvas!.getContext('2d')
      const norm = normRef.current
      if (!ctx || !norm) return

      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

      // Draw track polyline
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

      // Draw cars with Catmull-Rom spline interpolation
      const playhead = playheadRef.current
      const buffer = bufferRef.current
      const floor = Math.floor(playhead)

      // Four control points: p0 (prev), p1 (from), p2 (to), p3 (next)
      const s1 = buffer.get(floor) ?? null
      const s2 = buffer.get(floor + 1) ?? null

      if (!s1 || !s2) return  // need both flanking states

      const s0 = buffer.get(floor - 1) ?? s1  // fall back to s1 if no prior second
      const s3 = buffer.get(floor + 2) ?? s2  // fall back to s2 if no next second

      const t = playhead - floor  // fractional second [0, 1)

      for (const [driverId, p2car] of Object.entries(s2.cars)) {
        if (p2car.x == null || p2car.y == null || (p2car.x === 0 && p2car.y === 0)) continue

        const p1car = s1.cars[driverId]
        if (!p1car || (p1car.x === 0 && p1car.y === 0)) continue

        // Use surrounding points for tangents, falling back to p1/p2 if unavailable
        const p0car = s0.cars[driverId]
        const p3car = s3.cars[driverId]
        const p0x = (p0car && p0car.x !== 0) ? p0car.x : p1car.x
        const p0y = (p0car && p0car.y !== 0) ? p0car.y : p1car.y
        const p3x = (p3car && p3car.x !== 0) ? p3car.x : p2car.x
        const p3y = (p3car && p3car.y !== 0) ? p3car.y : p2car.y

        let drawX: number
        let drawY: number
        drawX = catmullRom(p0x, p1car.x, p2car.x, p3x, t)
        drawY = catmullRom(p0y, p1car.y, p2car.y, p3y, t)

        const [cx, cy] = norm.toCanvas(drawX, drawY)
        const color = driverColor(driverId)

        ctx.beginPath()
        ctx.arc(cx, cy, CAR_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()

        ctx.fillStyle = '#fff'
        ctx.font = 'bold 10px monospace'
        ctx.fillText(driverId, cx + CAR_RADIUS + 2, cy + 4)
      }

    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, [trackPoints, bufferRef, playheadRef])

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      style={{ background: '#1a1a1a', display: 'block' }}
    />
  )
}
