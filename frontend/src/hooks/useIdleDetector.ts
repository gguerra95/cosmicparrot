import { useEffect, useRef } from 'react'
import { useWsStore } from '../stores/wsStore'

const IDLE_MS = 60_000

export function useIdleDetector() {
  const send = useWsStore((s) => s.send)
  const idleRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    function goActive() {
      if (idleRef.current) {
        idleRef.current = false
        send({ type: 'tab_active' })
      }
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(goIdle, IDLE_MS)
    }

    function goIdle() {
      if (!idleRef.current) {
        idleRef.current = true
        send({ type: 'tab_idle' })
      }
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        goActive()
      } else {
        goIdle()
      }
    }

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']
    events.forEach((e) => window.addEventListener(e, goActive, { passive: true }))
    document.addEventListener('visibilitychange', handleVisibility)

    // Start the idle timer
    timerRef.current = setTimeout(goIdle, IDLE_MS)

    return () => {
      events.forEach((e) => window.removeEventListener(e, goActive))
      document.removeEventListener('visibilitychange', handleVisibility)
      clearTimeout(timerRef.current)
    }
  }, [send])
}
