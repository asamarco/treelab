
import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook to detect user inactivity.
 * @param onIdle - Function to call when the user is idle.
 * @param idleTime - The amount of time in milliseconds until the user is considered idle. 0 or a negative number disables the timer.
 */
export function useIdleTimer(onIdle: () => void, idleTime: number) {
  const timeoutId = useRef<NodeJS.Timeout | null>(null);

  const resetTimer = useCallback(() => {
    if (timeoutId.current) {
      clearTimeout(timeoutId.current);
    }
    if (idleTime > 0) {
      timeoutId.current = setTimeout(onIdle, idleTime);
    }
  }, [onIdle, idleTime]);

  const handleEvent = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    // If idleTime is 0 or less, do not set up any timers or listeners.
    if (idleTime <= 0) {
        if (timeoutId.current) clearTimeout(timeoutId.current);
        return;
    }

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];

    // Initial timer setup
    resetTimer();

    // Add event listeners
    events.forEach(event => window.addEventListener(event, handleEvent));

    // Cleanup function
    return () => {
      if (timeoutId.current) {
        clearTimeout(timeoutId.current);
      }
      events.forEach(event => window.removeEventListener(event, handleEvent));
    };
  }, [handleEvent, resetTimer, idleTime]);
}

    