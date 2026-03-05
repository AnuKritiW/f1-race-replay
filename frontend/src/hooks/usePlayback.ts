import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchState } from '../api/client'
import type { RaceState, RaceTimeline } from '../types'

type Speed = 1 | 5 | 10

interface PlaybackControls {
  raceState: RaceState | null
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
  const [raceState, setRaceState] = useState<RaceState | null>(null)

  const rafRef = useRef<number | null>(null)
  const lastTimestampRef = useRef<number | null>(null)
  const playheadRef = useRef(playheadTime)
  const speedRef = useRef(speed)
  const fetchingRef = useRef(false)

  // Keep refs in sync with state
  useEffect(() => { playheadRef.current = playheadTime }, [playheadTime])
  useEffect(() => { speedRef.current = speed }, [speed])

  // Fetch race state when playhead changes, skip if previous fetch still in flight
  useEffect(() => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    fetchState(raceId, playheadTime)
      .then(setRaceState)
      .finally(() => { fetchingRef.current = false })
  }, [raceId, playheadTime])

  const animate = useCallback((timestamp: number) => {
    if (lastTimestampRef.current === null) {
      lastTimestampRef.current = timestamp
    }
    const deltaMs = timestamp - lastTimestampRef.current
    lastTimestampRef.current = timestamp

    const next = playheadRef.current + (deltaMs * speedRef.current) / 1000

    if (next >= timeline.end_time) {
      setPlayheadTime(timeline.end_time)
      setIsPlaying(false)
      return
    }

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
    setPlayheadTime(Math.max(timeline.start_time, Math.min(t, timeline.end_time)))
  }, [timeline.start_time, timeline.end_time])

  return { raceState, playheadTime, isPlaying, speed, play, pause, setSpeed, scrubTo }
}
