import { useEffect, useState } from 'react'
import { api, downloadAttachment } from './api'

function AttachmentItem({ name, path, file, isImage, onRemove, toast }) {
  const [imageUrl, setImageUrl] = useState('')
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

  return <div className="attachment-item">
    {imageUrl && <img src={imageUrl} alt={name} />}
    <div className="attachment-line">
      <span title={name}>📎 {name}</span>
      {path && <button type="button" onClick={() => downloadAttachment(path, name).catch((e) => toast(e.message, 'error'))}>下载</button>}
      {onRemove && <button type="button" onClick={onRemove} aria-label={`移除 ${name}`}>移除</button>}
    </div>
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
