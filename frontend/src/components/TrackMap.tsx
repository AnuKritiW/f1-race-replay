import { useEffect, useRef, useState } from 'react'
import { fetchTrack } from '../api/client'
import type { RaceState } from '../types'
import { driverColor } from '../utils/driverColor'

interface Props {
  raceId: string
  bufferRef: React.RefObject<Map<number, RaceState>>
  playheadRef: React.RefObject<number>
  colorMap: Record<string, string>
}

const PADDING = 40
const CAR_RADIUS = 10

const CIRCUIT_ROTATION: Record<string, number> = {
  'sakhir': 92,
  'jeddah': 109,
  'melbourne': 43,
  'suzuka': 0,
  'shanghai': 123,
  'miami': 0,
  'imola': 0,
  'monte-carlo': -45,
  'montreal': 67,
  'catalunya': -58,
  'spielberg': 21,
  'silverstone': -90,
  'hungaroring': -51,
  'spa-francorchamps': 96,
  'zandvoort': 180,
  'monza': 94,
  'baku': -52,
  'singapore': 0,
  'austin': 0,
  'mexico-city': 7,
  'interlagos': -90,
  'las-vegas': 90,
  'lusail': 61,
  'yas-marina-circuit': -100  
}

function circuitKey(raceId: string): string {
  return raceId.replace(/-\d{4}-.*$/, '')
}

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


interface Normalizer {
  toCanvas: (x: number, y: number) => [number, number]
}

function buildNormalizer(
  points: Array<{ x: number; y: number }>,
  w: number,
  h: number,
  deg = 0,
): Normalizer {
  // Compute centroid from original points for stable rotation pivot
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  // Rotate all points to compute bounding box
  const rotated = deg === 0 ? points : points.map(({ x, y }) => {
    const dx = x - cx, dy = y - cy
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
  })

  const xs = rotated.map((p) => p.x)
  const ys = rotated.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const drawW = w - PADDING * 2
  const drawH = h - PADDING * 2
  const scaleX = drawW / (maxX - minX)
  const scaleY = drawH / (maxY - minY)
  const scale = Math.min(scaleX, scaleY)

  const offsetX = PADDING + (drawW - (maxX - minX) * scale) / 2
  const offsetY = PADDING + (drawH - (maxY - minY) * scale) / 2

  return {
    // Accepts raw (unrotated) coordinates — rotation is applied internally.
    // Both track points and car positions can be passed as-is.
    toCanvas: (x, y) => {
      let rx = x, ry = y
      if (deg !== 0) {
        const dx = x - cx, dy = y - cy
        rx = cx + dx * cos - dy * sin
        ry = cy + dx * sin + dy * cos
      }
      return [
        offsetX + (rx - minX) * scale,
        offsetY + (maxY - ry) * scale,
      ]
    },
  }
}

export function TrackMap({ raceId, bufferRef, playheadRef, colorMap }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [trackPoints, setTrackPoints] = useState<Array<{ x: number; y: number }>>([])
  const [size, setSize] = useState({ w: 800, h: 600 })
  const sizeRef = useRef(size)
  const normRef = useRef<Normalizer | null>(null)
  const colorMapRef = useRef<Record<string, string>>(colorMap)

  // const isDebugMode = new URLSearchParams(location.search).has('rotateDebug')
  // const [debugRotation, setDebugRotation] = useState(0)

  const effectiveRotation = CIRCUIT_ROTATION[circuitKey(raceId)] ?? 0
  // const effectiveRotation = isDebugMode ? debugRotation : (CIRCUIT_ROTATION[circuitKey(raceId)] ?? 0)

  // ResizeObserver — keep canvas filling its container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const s = { w: Math.max(1, Math.floor(width)), h: Math.max(1, Math.floor(height)) }
      sizeRef.current = s
      setSize(s)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fetch track points
  useEffect(() => {
    fetchTrack(raceId).then(setTrackPoints)
  }, [raceId])

  // Keep colorMapRef in sync without restarting the rAF loop
  useEffect(() => { colorMapRef.current = colorMap }, [colorMap])

  // Rebuild normalizer when track, canvas size, or rotation changes
  useEffect(() => {
    if (trackPoints.length > 0) {
      normRef.current = buildNormalizer(
        trackPoints,
        sizeRef.current.w,
        sizeRef.current.h,
        effectiveRotation,
      )
    }
  }, [trackPoints, size, effectiveRotation])

  // Dedicated rAF draw loop — runs at 60fps independent of React renders
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

      const { w, h } = sizeRef.current
      ctx.clearRect(0, 0, w, h)

      // Draw track glow pass
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'
      ctx.lineWidth = 14
      const [gx0, gy0] = norm.toCanvas(trackPoints[0].x, trackPoints[0].y)
      ctx.moveTo(gx0, gy0)
      for (let i = 1; i < trackPoints.length; i++) {
        const [gx, gy] = norm.toCanvas(trackPoints[i].x, trackPoints[i].y)
        ctx.lineTo(gx, gy)
      }
      ctx.stroke()

      // Draw track polyline
      ctx.beginPath()
      ctx.strokeStyle = '#3a3a3a'
      ctx.lineWidth = 5
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

      const s1 = buffer.get(floor) ?? null
      const s2 = buffer.get(floor + 1) ?? null
      if (!s1 || !s2) return

      const s0 = buffer.get(floor - 1) ?? s1
      const s3 = buffer.get(floor + 2) ?? s2
      const t = playhead - floor

      for (const [driverId, p2car] of Object.entries(s2.cars)) {
        if (p2car.x == null || p2car.y == null || (p2car.x === 0 && p2car.y === 0)) continue

        const p1car = s1.cars[driverId]
        if (!p1car || (p1car.x === 0 && p1car.y === 0)) continue

        const p0car = s0.cars[driverId]
        const p3car = s3.cars[driverId]
        const p0x = (p0car && p0car.x !== 0) ? p0car.x : p1car.x
        const p0y = (p0car && p0car.y !== 0) ? p0car.y : p1car.y
        const p3x = (p3car && p3car.x !== 0) ? p3car.x : p2car.x
        const p3y = (p3car && p3car.y !== 0) ? p3car.y : p2car.y

        const drawX = catmullRom(p0x, p1car.x, p2car.x, p3x, t)
        const drawY = catmullRom(p0y, p1car.y, p2car.y, p3y, t)

        // norm.toCanvas applies the same rotation as the track, keeping cars aligned
        const [cx, cy] = norm.toCanvas(drawX, drawY)
        const color = colorMapRef.current[driverId] ?? driverColor(driverId)

        // Car dot
        ctx.beginPath()
        ctx.arc(cx, cy, CAR_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()

        // Pill label background
        ctx.font = 'bold 10px monospace'
        const label = driverId
        const textW = ctx.measureText(label).width
        ctx.fillStyle = 'rgba(0,0,0,0.65)'
        const px = cx + CAR_RADIUS + 2
        const py = cy - 8
        const pw = textW + 6
        const ph = 14
        const pr = 3
        ctx.beginPath()
        ctx.moveTo(px + pr, py)
        ctx.lineTo(px + pw - pr, py)
        ctx.quadraticCurveTo(px + pw, py, px + pw, py + pr)
        ctx.lineTo(px + pw, py + ph - pr)
        ctx.quadraticCurveTo(px + pw, py + ph, px + pw - pr, py + ph)
        ctx.lineTo(px + pr, py + ph)
        ctx.quadraticCurveTo(px, py + ph, px, py + ph - pr)
        ctx.lineTo(px, py + pr)
        ctx.quadraticCurveTo(px, py, px + pr, py)
        ctx.closePath()
        ctx.fill()

        ctx.fillStyle = '#fff'
        ctx.fillText(label, cx + CAR_RADIUS + 5, cy + 4)
      }
    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, [trackPoints, bufferRef, playheadRef])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {trackPoints.length === 0 ? (
        <div style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(90deg, #1a1a1a 25%, #2a2a2a 50%, #1a1a1a 75%)',
          backgroundSize: '200% 100%',
          animation: 'pulse 1.5s infinite',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{ fontFamily: 'var(--font-data)', fontSize: '12px', color: 'var(--color-muted)' }}>
            Loading track…
          </span>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          style={{ display: 'block', background: 'var(--color-surface)' }}
        />
      )}
      {/* rotateDebug slider — uncomment to re-enable
      {isDebugMode && (
        <div style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.75)',
          color: '#fff',
          padding: '8px 14px',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontFamily: 'monospace',
          fontSize: 13,
          userSelect: 'none',
        }}>
          <span>rotateDebug</span>
          <input
            type="range"
            min="-180"
            max="180"
            value={debugRotation}
            onChange={(e) => setDebugRotation(Number(e.target.value))}
            style={{ width: 180 }}
          />
          <span style={{ minWidth: 48, textAlign: 'right' }}>{debugRotation}°</span>
          <span style={{ color: '#aaa' }}>key: <b style={{ color: '#fff' }}>{circuitKey(raceId)}</b></span>
        </div>
      )}
      */}
    </div>
  )
}
