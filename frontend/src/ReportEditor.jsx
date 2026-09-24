import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { api } from './api'

const IMAGE_TOKEN = /!\[([^\]\n]*)\]\(attachment:(pending-[a-z0-9-]+|\d+)\)/g

// One editable surface contains both the Markdown text and non-editable image nodes.
// The nodes serialize back to attachment references before the report is submitted.
const ReportEditor = forwardRef(function ReportEditor({ value, attachments, pending, placeholder, onChange, onRemoveImage, toast }, ref) {
  const editorRef = useRef(null)
  const rangeRef = useRef(null)
  const urlsRef = useRef([])
  const mountedRef = useRef(false)
  const callbacksRef = useRef({ onChange, onRemoveImage, toast })
  callbacksRef.current = { onChange, onRemoveImage, toast }

  const serializeNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replaceAll('\u200B', '')
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    if (node.dataset?.reportImage) return `![${node.dataset.imageName}](attachment:${node.dataset.reportImage})`
    if (node.tagName === 'BR') return '\n'
    const text = [...node.childNodes].map(serializeNode).join('')
    return node.tagName === 'DIV' || node.tagName === 'P' ? `${text}\n` : text
  }

  const serialize = () => [...(editorRef.current?.childNodes || [])].map(serializeNode).join('')
  const publish = () => callbacksRef.current.onChange(serialize())

  const rememberRange = () => {
    const selection = window.getSelection()
    const root = editorRef.current
    if (selection?.rangeCount && root?.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      rangeRef.current = selection.getRangeAt(0).cloneRange()
    }
  }

  const insertionRange = () => {
    const root = editorRef.current
    const range = rangeRef.current?.cloneRange() || document.createRange()
    if (!root.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(root)
      range.collapse(false)
    }
    return range
  }

  const placeCaret = (node) => {
    const range = document.createRange()
    range.setStart(node, node.nodeValue.length)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    rangeRef.current = range.cloneRange()
  }

  const imageNode = (token, name, file, path) => {
    const figure = document.createElement('span')
    figure.className = 'report-inline-image report-editor-image'
    figure.contentEditable = 'false'
    figure.dataset.reportImage = token
    figure.dataset.imageName = name

    const image = document.createElement('img')
    image.alt = name
    figure.appendChild(image)
    const caption = document.createElement('span')
    caption.className = 'report-editor-caption'
    const label = document.createElement('span')
    label.textContent = name
    caption.appendChild(label)
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '移除图片'
    remove.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      figure.remove()
      callbacksRef.current.onRemoveImage(token)
      publish()
    })
    caption.appendChild(remove)
    figure.appendChild(caption)

    if (file) {
      const url = URL.createObjectURL(file)
      urlsRef.current.push(url)
      image.src = url
    } else if (path) {
      api.fileBlob(path).then((blob) => {
        const url = URL.createObjectURL(blob)
        if (mountedRef.current && figure.isConnected) {
          urlsRef.current.push(url)
          image.src = url
        } else URL.revokeObjectURL(url)
      }).catch((error) => { if (figure.isConnected) callbacksRef.current.toast(error.message, 'error') })
    }
    return figure
  }

  useEffect(() => {
    mountedRef.current = true
    const root = editorRef.current
    root.replaceChildren()
    let offset = 0
    for (const match of value.matchAll(IMAGE_TOKEN)) {
      const before = value.slice(offset, match.index)
      if (before) root.appendChild(document.createTextNode(before))
      const saved = attachments.find((a) => String(a.id) === match[2])
      const local = pending.find((item) => `pending-${item.key}` === match[2])
      if (saved || local) {
        root.appendChild(imageNode(match[2], saved?.name || local.file.name, local?.file,
          saved ? `/reports/attachments/${saved.id}` : undefined))
      } else {
        root.appendChild(document.createTextNode(match[0]))
      }
      offset = match.index + match[0].length
    }
    if (offset < value.length) root.appendChild(document.createTextNode(value.slice(offset)))
    // A non-editable image at the end otherwise leaves Chrome with nowhere to put
    // the caret when the student clicks below it.
    if (root.lastChild?.dataset?.reportImage) root.appendChild(document.createTextNode('\n\u200B'))
    return () => {
      mountedRef.current = false
      urlsRef.current.forEach(URL.revokeObjectURL)
      urlsRef.current = []
    }
    // This editor owns its DOM until it is unmounted (including when switching to preview).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(ref, () => ({
    insertImages(items) {
      if (!items.length) return
      const root = editorRef.current
      const range = insertionRange()
      range.deleteContents()
      const fragment = document.createDocumentFragment()
      items.forEach((item) => {
        const name = item.file.name.replace(/[\]\n]/g, '')
        fragment.appendChild(document.createTextNode('\n'))
        fragment.appendChild(imageNode(`pending-${item.key}`, name, item.file))
      })
      const after = document.createTextNode('\n\u200B')
      fragment.appendChild(after)
      range.insertNode(fragment)
      root.focus()
      placeCaret(after)
      publish()
    },
  }))

  const insertText = (text) => {
    const range = insertionRange()
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    placeCaret(node)
    publish()
  }

  return <div ref={editorRef} className="report-editor" contentEditable suppressContentEditableWarning
    role="textbox" aria-label="周报正文" aria-multiline="true" data-placeholder={placeholder}
    onInput={() => { rememberRange(); publish() }}
    onKeyUp={rememberRange} onMouseUp={rememberRange} onBlur={rememberRange}
    onKeyDown={(event) => { if (event.target.isContentEditable && event.key === 'Enter') { event.preventDefault(); insertText('\n\u200B') } }}
    onPaste={(event) => { if (event.target.isContentEditable) { event.preventDefault(); insertText(event.clipboardData.getData('text/plain')) } }}
    onDrop={(event) => event.preventDefault()} />
})

export default ReportEditor
