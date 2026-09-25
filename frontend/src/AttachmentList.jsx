import { useEffect, useState } from 'react'
import { api, downloadAttachment } from './api'

function AttachmentItem({ name, path, file, isImage, onRemove, toast }) {
  const [imageUrl, setImageUrl] = useState('')
  const [download, setDownload] = useState(null)
  useEffect(() => {
    if (!isImage) return undefined
    let active = true
    let url = ''
    const load = async () => {
      try {
        const blob = file || await api.fileBlob(path)
        url = URL.createObjectURL(blob)
        if (active) setImageUrl(url)
        else URL.revokeObjectURL(url)
      } catch (e) { if (active) toast(e.message, 'error') }
    }
    load()
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [file, isImage, path, toast])
  useEffect(() => {
    if (!download?.complete) return undefined
    const timer = setTimeout(() => setDownload(null), 3000)
    return () => clearTimeout(timer)
  }, [download?.complete])

  const startDownload = async () => {
    if (download) return
    setDownload({ loaded: 0, total: null })
    try {
      await downloadAttachment(path, name, setDownload)
      setDownload((current) => ({ ...current, complete: true }))
      toast(`已开始下载「${name}」`, 'success')
    } catch (e) {
      toast(e.message, 'error')
      setDownload(null)
    }
  }

  const percent = download?.complete ? 100 : download?.total
    ? Math.min(100, Math.round(download.loaded / download.total * 100)) : null

  return <div className="attachment-item">
    {imageUrl && <img src={imageUrl} alt={name} />}
    <div className="attachment-line">
      <span title={name}>📎 {name}</span>
      {path && <button type="button" disabled={!!download} onClick={startDownload}>{download?.complete ? '已开始下载' : download ? '下载中…' : '下载'}</button>}
      {onRemove && <button type="button" onClick={onRemove} aria-label={`移除 ${name}`}>移除</button>}
    </div>
    {download && <div className="attachment-download" aria-live="polite">
      <div className={`attachment-download-track${percent === null ? ' indeterminate' : ''}`}
        role="progressbar" aria-label={`下载 ${name}`} aria-valuemin={0}
        aria-valuemax={percent === null ? undefined : 100} aria-valuenow={percent === null ? undefined : percent}>
        <i style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      <small>{download.complete ? '完成' : percent === null ? `已接收 ${(download.loaded / 1024 / 1024).toFixed(1)} MB` : `${percent}%`}</small>
    </div>}
  </div>
}

export default function AttachmentList({ existing = [], pending = [], pathFor, onRemoveExisting, onRemovePending, toast }) {
  if (!existing.length && !pending.length) return null
  return <div className="attachment-list">
    {existing.map((a) => <AttachmentItem key={`saved-${a.id}`} name={a.name} path={pathFor(a.id)}
      isImage={a.is_image} onRemove={onRemoveExisting && (() => onRemoveExisting(a.id))} toast={toast} />)}
    {pending.map((file, i) => <AttachmentItem key={`pending-${i}-${file.name}`} name={file.name} file={file}
      isImage={/^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(file.type)} onRemove={onRemovePending && (() => onRemovePending(i))} toast={toast} />)}
  </div>
}
