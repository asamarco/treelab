
/**
 * @fileoverview
 * This file defines a custom React hook, `useIsMobile`, which detects whether the
 * application is being viewed on a mobile device based on the screen width.
 *
 * It listens to window resize events and returns a boolean value indicating if the
 * current viewport width is below a defined mobile breakpoint (768px). This is useful
 * for rendering different layouts or components for mobile and desktop views.
 */
import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }

    // Initial check
    checkIsMobile()

    // Listen for resize events
    window.addEventListener("resize", checkIsMobile)

    // Cleanup
    return () => window.removeEventListener("resize", checkIsMobile)
  }, [])

  return isMobile
}
