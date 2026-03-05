import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchState } from '../api/client'
import type { RaceState, RaceTimeline } from '../types'

type Speed = 1 | 5 | 10

const BUFFER_AHEAD = 5  // seconds to pre-fetch ahead of playhead

interface PlaybackControls {
  bufferRef: React.RefObject<Map<number, RaceState>>
  playheadRef: React.RefObject<number>
  playheadTime: number
  isPlaying: boolean
  speed: Speed
  play: () => void
  pause: () => void
  setSpeed: (s: Speed) => void
  scrubTo: (t: number) => void
}

export function usePlayback(raceId: string, timeline: RaceTimeline): PlaybackControls {
  const [playheadTime, setPlayheadTime] = useState(timeline.start_time)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)

  const rafRef = useRef<number | null>(null)
  const lastTimestampRef = useRef<number | null>(null)
  const playheadRef = useRef(playheadTime)
  const speedRef = useRef(speed)
  const bufferRef = useRef<Map<number, RaceState>>(new Map())
  const fetchingSecondsRef = useRef<Set<number>>(new Set())
  const generationRef = useRef(0)

  useEffect(() => { speedRef.current = speed }, [speed])

  // Fill buffer BUFFER_AHEAD seconds ahead of playhead; only re-runs when integer second changes
  const currentSecond = Math.floor(playheadTime)
  useEffect(() => {
    const gen = generationRef.current

    // Evict entries more than 1 second behind playhead
    for (const key of bufferRef.current.keys()) {
      if (key < currentSecond - 1) bufferRef.current.delete(key)
    }

    const endSecond = Math.floor(timeline.end_time)
    for (let s = currentSecond; s <= Math.min(currentSecond + BUFFER_AHEAD, endSecond); s++) {
      if (bufferRef.current.has(s) || fetchingSecondsRef.current.has(s)) continue
      fetchingSecondsRef.current.add(s)
      fetchState(raceId, s)
        .then(state => {
          if (generationRef.current !== gen) return
          bufferRef.current.set(s, state)
        })
        .catch(() => { /* retry next second */ })
        .finally(() => { fetchingSecondsRef.current.delete(s) })
    }
  }, [raceId, currentSecond, timeline.end_time])

  const animate = useCallback((timestamp: number) => {
    if (lastTimestampRef.current === null) {
      lastTimestampRef.current = timestamp
    }
    const deltaMs = timestamp - lastTimestampRef.current
    lastTimestampRef.current = timestamp

    const next = playheadRef.current + (deltaMs * speedRef.current) / 1000

    if (next >= timeline.end_time) {
      playheadRef.current = timeline.end_time
      setPlayheadTime(timeline.end_time)
      setIsPlaying(false)
      return
    }

    // Update ref immediately so TrackMap's rAF sees it this frame
    playheadRef.current = next
    setPlayheadTime(next)
    rafRef.current = requestAnimationFrame(animate)
  }, [timeline.end_time])

  useEffect(() => {
    if (isPlaying) {
      lastTimestampRef.current = null
      rafRef.current = requestAnimationFrame(animate)
    } else {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [isPlaying, animate])

  const play = useCallback(() => setIsPlaying(true), [])
  const pause = useCallback(() => setIsPlaying(false), [])
  const scrubTo = useCallback((t: number) => {
    setIsPlaying(false)
    generationRef.current++
    bufferRef.current.clear()
    fetchingSecondsRef.current.clear()
    const clamped = Math.max(timeline.start_time, Math.min(t, timeline.end_time))
    playheadRef.current = clamped
    setPlayheadTime(clamped)
  }, [timeline.start_time, timeline.end_time])

  return { bufferRef, playheadRef, playheadTime, isPlaying, speed, play, pause, setSpeed, scrubTo }
}
