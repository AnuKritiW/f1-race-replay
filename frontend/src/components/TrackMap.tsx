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

      // Draw cars with interpolation between buffered states
      const playhead = playheadRef.current
      const buffer = bufferRef.current
      const floor = Math.floor(playhead)
      const fromState = buffer.get(floor) ?? null
      const toState = buffer.get(floor + 1) ?? fromState  // fall back if next second not buffered yet

      if (!fromState) return  // buffer not loaded yet

      const t = playhead - floor  // fractional second [0, 1)

      for (const [driverId, toCar] of Object.entries(toState!.cars)) {
        if (toCar.x == null || toCar.y == null || (toCar.x === 0 && toCar.y === 0)) continue

        const fromCar = fromState.cars[driverId]
        let drawX = toCar.x
        let drawY = toCar.y
        if (fromCar && !(fromCar.x === 0 && fromCar.y === 0)) {
          drawX = fromCar.x + (toCar.x - fromCar.x) * t
          drawY = fromCar.y + (toCar.y - fromCar.y) * t
        }

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
