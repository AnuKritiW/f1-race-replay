import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchScrubBuffer, fetchTileStates, fetchTileTiming } from '../api/client'
import type { RaceState, RaceTimeline, ScrubFrame, TimingState } from '../types'

type Speed = 1 | 5 | 10
const TILE_SIZE = 300 // seconds per tile

interface PlaybackControls {
  bufferRef: React.RefObject<Map<number, RaceState>>
  timingBufferRef: React.RefObject<Map<number, TimingState>>
  scrubBufferRef: React.RefObject<Map<number, ScrubFrame>>
  playheadRef: React.RefObject<number>
  playheadTime: number
  isLoaded: boolean
  isPlaying: boolean
  isBuffering: boolean
  loadedRanges: [number, number][]
  speed: Speed
  play: () => void
  pause: () => void
  setSpeed: (s: Speed) => void
  scrubTo: (t: number) => void
  onScrubSettle: (t: number) => void
}

export function usePlayback(raceId: string, timeline: RaceTimeline): PlaybackControls {
  const [playheadTime, setPlayheadTime] = useState(timeline.start_time)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)
  const [isBuffering, setIsBuffering] = useState(false)
  const [loadedRanges, setLoadedRanges] = useState<[number, number][]>([])
  const isBufferingRef = useRef(false)

  const rafRef = useRef<number | null>(null)
  const lastTimestampRef = useRef<number | null>(null)
  const playheadRef = useRef(playheadTime)
  const speedRef = useRef(speed)
  const bufferRef = useRef<Map<number, RaceState>>(new Map())
  const timingBufferRef = useRef<Map<number, TimingState>>(new Map())
  const scrubBufferRef = useRef<Map<number, ScrubFrame>>(new Map())
  const loadedTilesRef = useRef<Set<number>>(new Set())
  const loadingTilesRef = useRef<Set<number>>(new Set())
  const scrubSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep raceId and timeline in a ref so tile-loading callbacks always see latest values
  const raceIdRef = useRef(raceId)
  const timelineRef = useRef(timeline)
  useEffect(() => { raceIdRef.current = raceId }, [raceId])
  useEffect(() => { timelineRef.current = timeline }, [timeline])

  useEffect(() => { speedRef.current = speed }, [speed])

  const loadTileAt = useCallback((t: number, prefetchNext = false) => {
    const { start_time, duration } = timelineRef.current
    const idx = Math.floor((t - start_time) / TILE_SIZE)
    if (idx < 0) return

    if (!loadedTilesRef.current.has(idx) && !loadingTilesRef.current.has(idx)) {
      loadingTilesRef.current.add(idx)
      const from = Math.floor(start_time + idx * TILE_SIZE)
      const to = from + TILE_SIZE - 1
      const fetchedForRace = raceIdRef.current

      Promise.all([
        fetchTileStates(fetchedForRace, from, to),
        fetchTileTiming(fetchedForRace, from, to).catch(() => [] as TimingState[]),
      ]).then(([states, frames]) => {
        if (raceIdRef.current !== fetchedForRace) return // race changed while fetching
        for (const state of states) {
          bufferRef.current.set(Math.floor(state.timestamp), state)
        }
        for (const frame of frames) {
          timingBufferRef.current.set(Math.floor(frame.timestamp), frame)
        }
        loadedTilesRef.current.add(idx)
        loadingTilesRef.current.delete(idx)

        // Evict tiles outside ±2 range to bound memory
        const playheadTile = Math.floor((playheadRef.current - start_time) / TILE_SIZE)
        for (const ti of [...loadedTilesRef.current]) {
          if (Math.abs(ti - playheadTile) > 2) {
            loadedTilesRef.current.delete(ti)
            const tStart = Math.floor(start_time + ti * TILE_SIZE)
            const tEnd = tStart + TILE_SIZE
            for (let ts = tStart; ts <= tEnd; ts++) {
              bufferRef.current.delete(ts)
              timingBufferRef.current.delete(ts)
            }
          }
        }

        // Update loaded ranges state for scrubber visualisation
        const { start_time: st } = timelineRef.current
        setLoadedRanges([...loadedTilesRef.current].map(ti => [
          Math.floor(st + ti * TILE_SIZE),
          Math.floor(st + (ti + 1) * TILE_SIZE),
        ]))

        // Auto-resume if we were buffering for this tile
        if (isBufferingRef.current) {
          const playheadTileIdx = Math.floor((playheadRef.current - st) / TILE_SIZE)
          if (idx === playheadTileIdx || idx === playheadTileIdx + 1) {
            isBufferingRef.current = false
            setIsBuffering(false)
            setIsPlaying(true)
          }
        }
      })
    }

    if (prefetchNext) {
      const nextIdx = idx + 1
      const maxIdx = Math.ceil(duration / TILE_SIZE)
      if (nextIdx <= maxIdx && !loadedTilesRef.current.has(nextIdx) && !loadingTilesRef.current.has(nextIdx)) {
        const nextFrom = Math.floor(start_time + nextIdx * TILE_SIZE)
        loadTileAt(nextFrom, false)
      }
    }
  }, []) // stable — uses refs only

  // Phase 1: load scrub buffer on session open, then preload tile 0
  useEffect(() => {
    setIsLoaded(false)
    setIsPlaying(false)
    playheadRef.current = timeline.start_time
    setPlayheadTime(timeline.start_time)
    bufferRef.current.clear()
    timingBufferRef.current.clear()
    scrubBufferRef.current.clear()
    loadedTilesRef.current.clear()
    loadingTilesRef.current.clear()
    if (scrubSettleTimerRef.current) clearTimeout(scrubSettleTimerRef.current)

    let cancelled = false
    fetchScrubBuffer(raceId).then(frames => {
      if (cancelled) return
      for (const frame of frames) {
        scrubBufferRef.current.set(frame.t, frame)
      }
      setIsLoaded(true)
      // Preload tile 0 so the user can play immediately
      loadTileAt(timeline.start_time, true)
    })
    return () => { cancelled = true }
  }, [raceId, timeline.start_time, loadTileAt])

  const animate = useCallback((timestamp: number) => {
    if (lastTimestampRef.current === null) {
      lastTimestampRef.current = timestamp
    }
    const deltaMs = timestamp - lastTimestampRef.current
    lastTimestampRef.current = timestamp

    const next = playheadRef.current + (deltaMs * speedRef.current) / 1000

    if (next >= timelineRef.current.end_time) {
      playheadRef.current = timelineRef.current.end_time
      setPlayheadTime(timelineRef.current.end_time)
      setIsPlaying(false)
      return
    }

    // Proactive prefetch: start loading the next tile when within 60 race-seconds of the boundary
    const { start_time } = timelineRef.current
    const currentTileIdx = Math.floor((next - start_time) / TILE_SIZE)
    const nextTileBoundary = start_time + (currentTileIdx + 1) * TILE_SIZE
    if (next + 60 >= nextTileBoundary) {
      loadTileAt(nextTileBoundary, false)
    }

    // Auto-pause and buffer if the next position is in an unloaded tile
    const nextTileIdx = Math.floor((next - start_time) / TILE_SIZE)
    if (!loadedTilesRef.current.has(nextTileIdx)) {
      if (!loadingTilesRef.current.has(nextTileIdx)) {
        loadTileAt(next, true)
      }
      isBufferingRef.current = true
      setIsBuffering(true)
      setIsPlaying(false) // must go false so setIsPlaying(true) on resume triggers the effect
      return
    }

    playheadRef.current = next
    setPlayheadTime(next)
    rafRef.current = requestAnimationFrame(animate)
  }, [loadTileAt])

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

  const play = useCallback(() => {
    loadTileAt(playheadRef.current, true)
    setIsPlaying(true)
  }, [loadTileAt])

  const pause = useCallback(() => {
    isBufferingRef.current = false
    setIsBuffering(false)
    setIsPlaying(false)
  }, [])

  const scrubTo = useCallback((t: number) => {
    setIsPlaying(false)
    const clamped = Math.max(timelineRef.current.start_time, Math.min(t, timelineRef.current.end_time))
    playheadRef.current = clamped
    setPlayheadTime(clamped)
    // Debounce tile load for keyboard scrubbing (arrow keys)
    if (scrubSettleTimerRef.current) clearTimeout(scrubSettleTimerRef.current)
    scrubSettleTimerRef.current = setTimeout(() => {
      loadTileAt(clamped, true)
    }, 400)
  }, [loadTileAt])

  const onScrubSettle = useCallback((t: number) => {
    // Called on mouseup/touchend — load immediately, cancel debounce
    if (scrubSettleTimerRef.current) clearTimeout(scrubSettleTimerRef.current)
    const clamped = Math.max(timelineRef.current.start_time, Math.min(t, timelineRef.current.end_time))
    loadTileAt(clamped, true)
  }, [loadTileAt])

  return {
    bufferRef, timingBufferRef, scrubBufferRef,
    playheadRef, playheadTime, isLoaded, isPlaying, isBuffering, loadedRanges,
    speed, play, pause, setSpeed, scrubTo, onScrubSettle,
  }
}
