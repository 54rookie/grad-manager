import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 手账风下拉筛选器（原型 .hselect 的受控组件版）
 *
 * Props:
 *  - value    当前选中值（对应 option.value）
 *  - options  [{ value, label }]
 *  - onChange (value) => void
 *  - label   （可选）组件位上方的手写小标签
 *
 * 下拉列表通过 createPortal 挂载到 body，避免被 Banner 的 overflow 裁剪。
 */
export default function HandDrawnSelect({ value, options = [], onChange, label, width = 218 }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 218 })
  const boxRef = useRef(null)

  /* 展开时测量按钮位置，让 Portal 里的列表对齐到按钮正下方 */
  const toggle = () => {
    if (!open && boxRef.current) {
      const r = boxRef.current.getBoundingClientRect()
      setPos({ top: r.bottom, left: r.left, width: r.width })
    }
    setOpen((v) => !v)
  }

  /* 点击外部收起 + ESC 收起 */
  useEffect(() => {
    if (!open) return undefined
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => o.value === value) || options[0]

  return (
    <div className={`hselect${open ? ' open' : ''}`} ref={boxRef} style={{ width }}>
      <button
        className="hselect-btn"
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle() }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="hselect-value">{current ? current.label : '—'}</span>
        <svg className="arrow" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M3.5 6 L8 10.5 L12.5 6" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {label && <div className="slot-3-label"><i>✎</i> {label}</div>}

      {open && createPortal(
        <ul
          className="hselect-list hselect-list-portal"
          role="listbox"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: 'none', opacity: 1 }}
        >
          {options.map((o) => (
            <li
              key={String(o.value)}
              className={o.value === value ? 'on' : ''}
              onClick={() => {
                setOpen(false)
                if (o.value !== value) onChange?.(o.value)
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  )
}
