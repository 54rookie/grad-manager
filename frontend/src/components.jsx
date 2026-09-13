// 共享组件：弹窗 + 周数下拉框

export function Modal({ title, onClose, wide, children }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className={`modal${wide ? ' wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function WeekSelect({ weeks, value, onChange, current }) {
  return (
    <label className="select-wrap">
      <span>选择周次</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {weeks.map((w) => (
          <option key={w} value={w}>
            {w}{w === current ? '（本周）' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
