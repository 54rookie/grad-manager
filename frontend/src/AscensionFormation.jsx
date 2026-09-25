import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef } from 'react'
import formationSvg from './assets/ascension-formation.svg?raw'

// 直接使用「飞升期-阵法.html」的 SVG 与样式。每个实例单独命名 defs/id，
// 避免 Banner 和 Weekly 同时出现时互相引用渐变、滤镜或法阵。
const AscensionFormation = forwardRef(function AscensionFormation({ hoverSelf = true, className = '' }, ref) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const root = useRef(null)
  const holdTimer = useRef(null)
  const endTimer = useRef(null)
  const markup = useMemo(() => {
    const ids = [...formationSvg.matchAll(/\s+id="([^"]+)"/g)].map((match) => match[1])
    let result = formationSvg
    for (const id of ids.sort((a, b) => b.length - a.length)) {
      result = result.replaceAll(`id="${id}"`, `id="${reactId}-${id}"`)
        .replaceAll(`#${id}`, `#${reactId}-${id}`)
    }
    return result.replace(`id="${reactId}-af-mx-fx"`, `id="${reactId}-af-mx-fx" data-formation-effect="true"`)
  }, [reactId])

  const activate = () => {
    clearTimeout(holdTimer.current)
    clearTimeout(endTimer.current)
    const fx = root.current?.querySelector('[data-formation-effect]')
    fx?.classList.remove('af-mx-closing')
    fx?.classList.add('af-mx-on')
  }

  const deactivate = () => {
    clearTimeout(holdTimer.current)
    clearTimeout(endTimer.current)
    // 与参考文件一致：保持 1 秒，再用 1.5 秒收回阵法。
    holdTimer.current = setTimeout(() => {
      const fx = root.current?.querySelector('[data-formation-effect]')
      fx?.classList.add('af-mx-closing')
      endTimer.current = setTimeout(() => {
        fx?.classList.remove('af-mx-on', 'af-mx-closing')
      }, 1500)
    }, 1000)
  }

  useImperativeHandle(ref, () => ({ activate, deactivate }))
  useEffect(() => () => {
    clearTimeout(holdTimer.current)
    clearTimeout(endTimer.current)
  }, [])

  return <span className={className} ref={root}
    onMouseEnter={hoverSelf ? activate : undefined}
    onMouseLeave={hoverSelf ? deactivate : undefined}
    role="img" aria-label="飞升期修仙者与阵法"
    dangerouslySetInnerHTML={{ __html: markup }} />
})

export default AscensionFormation
