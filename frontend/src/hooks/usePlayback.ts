import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchBulkStates, fetchBulkTiming } from '../api/client'
import type { RaceState, RaceTimeline, TimingState } from '../types'

type Speed = 1 | 5 | 10

interface PlaybackControls {
  bufferRef: React.RefObject<Map<number, RaceState>>
  timingBufferRef: React.RefObject<Map<number, TimingState>>
  playheadRef: React.RefObject<number>
  playheadTime: number
  isLoaded: boolean
  isPlaying: boolean
  speed: Speed
  play: () => void
  pause: () => void
  setSpeed: (s: Speed) => void
  scrubTo: (t: number) => void
}

export function usePlayback(raceId: string, timeline: RaceTimeline): PlaybackControls {
  const [playheadTime, setPlayheadTime] = useState(timeline.start_time)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)

  const rafRef = useRef<number | null>(null)
  const lastTimestampRef = useRef<number | null>(null)
  const playheadRef = useRef(playheadTime)
  const speedRef = useRef(speed)
  const bufferRef = useRef<Map<number, RaceState>>(new Map())
  const timingBufferRef = useRef<Map<number, TimingState>>(new Map())

  useEffect(() => { speedRef.current = speed }, [speed])

  // Load both buffers in parallel; isLoaded waits for both
  useEffect(() => {
    let statesLoaded = false
    let timingLoaded = false

    function checkBothLoaded() {
      if (statesLoaded && timingLoaded) setIsLoaded(true)
    }

    fetchBulkStates(raceId).then(states => {
      for (const state of states) {
        bufferRef.current.set(Math.floor(state.timestamp), state)
      }
      statesLoaded = true
      checkBothLoaded()
    })

    fetchBulkTiming(raceId).then(frames => {
      for (const frame of frames) {
        timingBufferRef.current.set(Math.floor(frame.timestamp), frame)
      }
      timingLoaded = true
      checkBothLoaded()
    }).catch(() => {
      // Timing data may not exist yet for sessions ingested before Phase 3
      timingLoaded = true
      checkBothLoaded()
    })
  }, [raceId])

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
    const clamped = Math.max(timeline.start_time, Math.min(t, timeline.end_time))
    playheadRef.current = clamped
    setPlayheadTime(clamped)
  }, [timeline.start_time, timeline.end_time])

  return { bufferRef, timingBufferRef, playheadRef, playheadTime, isLoaded, isPlaying, speed, play, pause, setSpeed, scrubTo }
}
