import { useEffect, useRef } from 'react'
import svg from './assets/overdue-tribulation.svg?raw'
import animateOverdue from './overdueAnimation'

export default function OverdueFigure() {
  const host = useRef(null)

  useEffect(() => {
    // Each card gets its own SVG document scope, so the reference file's IDs,
    // selectors and keyframes cannot collide with other figures on the page.
    const root = host.current.shadowRoot || host.current.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>:host{display:block;width:100%;height:100%;pointer-events:none}svg{display:block;width:100%;height:100%;overflow:visible}</style>${svg}`
    return animateOverdue(root)
  }, [])

  return <span className="report-student-figure" ref={host} aria-hidden="true" />
}
