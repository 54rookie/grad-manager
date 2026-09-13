import { useEffect, useRef } from 'react'

/**
 * 海风骑行 · 鹈鹕与自行车（移植自用户提供的 SVG，已去掉天空/海面/道路等背景）
 * 保留可动的部分：车轮旋转、双腿踩踏、身体起伏、围巾飘动、眨眼与风线。
 * 原版由 JS 驱动 requestAnimationFrame，这里按同样的数学复刻。
 */
const CADENCE = Math.PI * 2 * 0.6
const GEAR_RATIO = 1.65

function positionLeg(outline, color, foot, x, y, hipX, hipY) {
  const ankleX = x - 8
  const ankleY = y - 8
  const dx = ankleX - hipX
  const dy = ankleY - hipY
  const distance = Math.max(0.001, Math.hypot(dx, dy))
  const upper = 65
  const lower = 66
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance)
  const bend = Math.sqrt(Math.max(0, upper * upper - along * along))
  const kneeX = hipX + (dx * along) / distance + (dy * bend) / distance
  const kneeY = hipY + (dy * along) / distance - (dx * bend) / distance
  const shape = `M${hipX.toFixed(2)} ${hipY.toFixed(2)}L${kneeX.toFixed(2)} ${kneeY.toFixed(2)}L${ankleX.toFixed(2)} ${ankleY.toFixed(2)}`
  outline.setAttribute('d', shape)
  color.setAttribute('d', shape)
  foot.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`)
}

export default function Pelican({ speed = 1 }) {
  const root = useRef(null)

  useEffect(() => {
    const el = root.current
    if (!el) return undefined
    const part = (id) => el.querySelector(`#pr-${id}`)
    const crank = part('crank')
    const rear = part('rear-spokes')
    const front = part('front-spokes')
    const scarf = part('scarf-tail')
    const eye = part('eye')
    const breeze = part('breeze')
    const bird = part('bird')
    const legs = ['far', 'near'].map((side) => ({
      outline: part(`${side}-leg-outline`),
      color: part(`${side}-leg-color`),
      foot: part(`${side}-foot`),
    }))
    if (!crank || !legs[0].outline || !bird) return undefined

    let rate = speed
    let rideTime = 0
    let previous = null
    let frameId = null

    const draw = () => {
      const phase = rideTime * CADENCE
      const angle = (phase * 180) / Math.PI
      const wheelAngle = angle * GEAR_RATIO
      const bob = Math.sin(phase * 2) * 1.6
      const pedalX = Math.cos(phase) * 28
      const pedalY = Math.sin(phase) * 28
      crank.setAttribute('transform', `translate(431 415) rotate(${angle % 360})`)
      rear?.setAttribute('transform', `rotate(${wheelAngle % 360})`)
      front?.setAttribute('transform', `rotate(${wheelAngle % 360})`)
      bird.setAttribute('transform', `translate(0 ${bob})`)
      positionLeg(legs[0].outline, legs[0].color, legs[0].foot, 431 - pedalX, 415 - pedalY, 411, 317 + bob)
      positionLeg(legs[1].outline, legs[1].color, legs[1].foot, 431 + pedalX, 415 + pedalY, 421, 320 + bob)
      scarf?.setAttribute('transform', `rotate(${Math.sin(phase * 2.5) * 4} 457 237)`)
      const blinkAt = rideTime % 5.4
      const blink = blinkAt > 5.23 ? 0.12 + 0.88 * Math.abs((blinkAt - 5.315) / 0.085) : 1
      eye?.setAttribute('transform', `translate(0 ${188 * (1 - blink)}) scale(1 ${blink})`)
      if (breeze) {
        breeze.setAttribute('opacity', rate === 0 ? 0 : Math.min(0.8, rate * 0.5))
        breeze.setAttribute('transform', `translate(${-12 * Math.sin(phase)} 0)`)
      }
    }

    const frame = (timestamp) => {
      frameId = null
      if (!el.isConnected) return
      if (previous !== null) {
        const seconds = Math.min((timestamp - previous) / 1000, 0.05)
        rideTime += seconds * rate
      }
      previous = timestamp
      draw()
      if (rate > 0 && !document.hidden) frameId = requestAnimationFrame(frame)
    }

    const resume = () => {
      if (rate > 0 && frameId === null && !document.hidden) {
        previous = null
        frameId = requestAnimationFrame(frame)
      }
    }

    const onVisibility = () => {
      if (document.hidden && frameId !== null) {
        cancelAnimationFrame(frameId)
        frameId = null
      } else resume()
    }

    draw()
    resume()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [speed])

  return (
    <div className="pelican" ref={root}>
      <svg className="pr-scene" viewBox="222 128 486 390" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <g id="pr-wheel-spokes" stroke="#719890" strokeWidth="1.7">
            <path d="M-78 0H78M0-78V78M-55.15-55.15L55.15 55.15M-55.15 55.15L55.15-55.15M-72.06-29.85L72.06 29.85M-72.06 29.85L72.06-29.85M-29.85-72.06L29.85 72.06M-29.85 72.06L29.85-72.06" />
            <path d="M43-65L49-58" stroke="#ffb794" strokeWidth="6" strokeLinecap="round" />
          </g>
        </defs>

        <g id="pr-bicycle">
          <g fill="none">
            <circle cx="320" cy="415" r="86" stroke="#294a49" strokeWidth="11" />
            <circle cx="600" cy="415" r="86" stroke="#294a49" strokeWidth="11" />
            <circle cx="320" cy="415" r="79" stroke="#a9c0b5" strokeWidth="3" />
            <circle cx="600" cy="415" r="79" stroke="#a9c0b5" strokeWidth="3" />
          </g>
          <g transform="translate(320 415)"><g id="pr-rear-spokes"><use href="#pr-wheel-spokes" /></g></g>
          <g transform="translate(600 415)"><g id="pr-front-spokes"><use href="#pr-wheel-spokes" /></g></g>
          <g className="pr-line" strokeWidth="3">
            <circle cx="320" cy="415" r="7" fill="#a9c0b5" />
            <circle cx="600" cy="415" r="7" fill="#a9c0b5" />
          </g>
          <g id="pr-far-leg" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path id="pr-far-leg-outline" stroke="#294a49" strokeWidth="13" />
            <path id="pr-far-leg-color" stroke="#c28a42" strokeWidth="8" />
          </g>
          <g id="pr-far-foot" className="pr-line" strokeWidth="2.5">
            <path d="M-11-10Q-7-13-4-8L14-5L24 2Q15 8 8 3Q0 8-7 3L-17 3Z" fill="#c28a42" />
            <path d="M-12 7H18" fill="none" strokeWidth="5" />
          </g>
          <path d="M320 403L427 392C460 389 465 439 430 440L320 426C302 425 302 404 320 403Z" fill="none" stroke="#294a49" strokeWidth="3" />
          <g fill="none" strokeLinejoin="round" strokeLinecap="round">
            <path d="M320 415L402 330L431 415H320L402 330L559 330L431 415M559 330L600 415" stroke="#294a49" strokeWidth="12" />
            <path d="M320 415L402 330L431 415H320M402 330L559 330L431 415M559 330L600 415" stroke="#e87b63" strokeWidth="7" />
            <path d="M411 339L544 339" stroke="#ffb794" strokeWidth="2" />
            <path d="M402 330L397 309M559 330L550 300L576 292" stroke="#294a49" strokeWidth="8" />
            <path d="M398 314L401 326M552 306L557 325" stroke="#a9c0b5" strokeWidth="4" />
            <path d="M570 294L584 290Q595 290 595 301" stroke="#294a49" strokeWidth="9" />
            <path d="M586 299Q572 314 583 353" stroke="#294a49" strokeWidth="1.6" />
          </g>
          <path d="M370 306Q393 298 422 305Q428 310 421 316H378Q367 315 370 306Z" fill="#294a49" />
          <path d="M376 306Q397 303 417 308" fill="none" stroke="#a9c0b5" strokeWidth="2" strokeLinecap="round" />
          <circle cx="431" cy="415" r="23" fill="#a9c0b5" stroke="#294a49" strokeWidth="3.5" />
          <circle cx="431" cy="415" r="15" fill="#e3debd" stroke="#294a49" strokeWidth="2" />
          <g id="pr-crank" className="pr-line" fill="none">
            <path d="M-28 0H28" strokeWidth="7" />
            <path d="M-28 0H28" stroke="#a9c0b5" strokeWidth="3" />
          </g>
          <circle cx="431" cy="415" r="5" fill="#294a49" />
          <g id="pr-near-leg" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path id="pr-near-leg-outline" stroke="#294a49" strokeWidth="14" />
            <path id="pr-near-leg-color" stroke="#e7a443" strokeWidth="9" />
          </g>
          <g id="pr-near-foot" className="pr-line" strokeWidth="2.5">
            <path d="M-11-10Q-7-13-4-8L14-5L24 2Q15 8 8 3Q0 8-7 3L-17 3Z" fill="#e7a443" />
            <path d="M-2-4L8 3M6-4L17 3" fill="none" stroke="#c28a42" strokeWidth="1.5" />
            <path d="M-12 7H18" fill="none" strokeWidth="5" />
          </g>
        </g>

        <g id="pr-bird">
          <g id="pr-breeze" fill="none" stroke="#b9cbbd" strokeWidth="4" strokeLinecap="round" opacity=".6">
            <path d="M231 252H275M218 264H253M255 237H283" />
          </g>
          <path d="M355 280Q327 268 303 276L322 290L307 297Q338 310 363 299Z" className="pr-feather" />
          <path d="M314 283L342 291M320 294L341 297" className="pr-feather-mark" />
          <path d="M427 253Q400 238 371 251C344 264 340 301 367 316C387 332 428 331 449 312C472 292 471 271 461 249C451 228 447 212 455 190C461 168 482 158 504 166C523 172 527 191 516 206C504 220 486 217 482 232C480 244 492 268 480 288C473 300 460 306 447 306" className="pr-feather" />
          <path d="M457 212Q460 238 467 254Q482 293 439 307C426 322 397 326 377 317C407 341 450 325 465 307C484 299 494 278 480 249Q473 232 487 222Z" fill="#d9e6da" />
          <path d="M371 262Q356 267 356 282" fill="none" stroke="#fcfcf0" strokeWidth="4" strokeLinecap="round" />
          <path d="M460 238Q430 230 409 240Q427 242 423 251Q443 247 466 248Z" fill="#e98265" className="pr-line" strokeWidth="2.5" />
          <path id="pr-scarf-tail" d="M456 240Q428 222 392 231L406 219L390 214Q430 209 463 232Z" fill="#e98265" className="pr-line" strokeWidth="2.5" />
          <path d="M454 236Q467 240 479 235L482 246Q467 253 457 246Z" fill="#e98265" className="pr-line" strokeWidth="2.5" />
          <path d="M454 179Q452 151 475 143C496 134 521 148 525 175L517 180Q491 164 460 185Z" fill="#426f66" className="pr-line" strokeWidth="3.5" />
          <path d="M466 165Q467 152 479 148M481 160Q483 149 490 147M498 161Q500 152 498 149" fill="none" stroke="#294a49" strokeWidth="4" strokeLinecap="round" />
          <path d="M461 182L478 211L495 211" fill="none" stroke="#294a49" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M456 180Q487 166 522 179" fill="none" stroke="#294a49" strokeWidth="4" strokeLinecap="round" />
          <path d="M513 199L684 203C654 216 634 232 606 245C568 265 523 246 513 216Z" fill="#f2ce86" className="pr-line" strokeWidth="3.5" />
          <path d="M529 217Q554 256 604 237" fill="none" stroke="#f0b647" strokeWidth="3" strokeLinecap="round" opacity=".8" />
          <path d="M518 187Q578 184 657 197L685 203Q603 214 517 205Z" fill="#f0b647" className="pr-line" strokeWidth="3.5" />
          <path d="M527 191Q585 191 651 199" fill="none" stroke="#ffd373" strokeWidth="4" strokeLinecap="round" />
          <path d="M680 204Q684 210 687 204" fill="none" stroke="#294a49" strokeWidth="2" strokeLinecap="round" />
          <circle cx="505" cy="189" r="10" fill="#d9e6da" />
          <g id="pr-eye">
            <ellipse cx="506" cy="188" rx="4.3" ry="5.4" fill="#294a49" />
            <circle cx="507.1" cy="186.4" r="1.5" fill="#fffdf0" />
          </g>
          <path d="M499 176Q505 173 511 177" fill="none" stroke="#294a49" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M369 274Q392 249 422 269C448 285 482 294 518 294L543 289Q551 287 552 294L538 306C502 320 456 313 429 302Q389 319 369 300Q362 290 369 274Z" className="pr-feather" />
          <path d="M378 281Q396 282 412 296Q452 304 472 303M379 291Q393 297 407 302M383 303Q395 307 410 305" className="pr-feather-mark" />
          <path d="M516 302L540 298M520 307L535 304" className="pr-feather-mark" />
        </g>
      </svg>
    </div>
  )
}
