/**
 * Gargantua 渲染引擎（原生 185 行脚本的无框架移植）
 *
 * 从 gargantua.html 的 IIFE 里搬出来，只做一件事：把黑洞 + 飞船画出来。
 * 不引用 React，不认识登录业务——表单校验、真实登录、路由跳转都在 Login.jsx 里。
 *
 * 之所以要拆出来：原脚本把「逐帧计算」和「DOM 业务」揉在一起
 * （form.submit / fullscreen / h 快捷键 / status 文案都写在同一个作用域），
 * 直接塞进组件会让 React 状态和 60fps 的命令式循环互相打架。
 *
 * 收进这个闭包的状态（time / warp / energy / particles / shipTrail / phase …）
 * 全部只参与逐帧运算、不驱动 React 重绘，所以按「一律 useRef 托管」的原则处理——
 * 只是更进一步收进模块作用域，连 ref 都不用。
 */
import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders'

export function createGargantua({ cosmos, flight, scene, hud, progressRing, onFlag }) {
  const ctx = flight.getContext('2d')

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let reduced = motion.matches
  let gl = null
  let program = null
  const uniforms = {}
  let w = 1
  let h = 1
  let mobile = false

  let time = 0
  let last = 0
  let raf = 0
  let frames = 0
  let slow = 0
  let resolutionScale = 1
  let px = 0
  let py = 0
  let tx = 0
  let ty = 0
  let energy = 0
  let warp = 0
  let busy = false
  let launchAt = 0
  let quietAt = performance.now()
  let phase = 0.62
  let particles = []
  let emitBudget = 0
  let shipTrail = []
  let hudBounds = { x: 0, y: 0, width: 0 }
  let randomState = 172911
  let disposed = false

  const rand = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    return randomState / 4294967296
  }
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n))
  const ease = (a, b, n) => {
    const t = clamp((n - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
  }
  /* 只在值真正翻转时回调 —— quiet 原本每 30 帧算一次，
     60fps 地往 React 里 setState 会把渲染打爆 */
  const flags = { quiet: false }
  const setFlag = (name, value) => {
    if (flags[name] === value) return
    flags[name] = value
    onFlag?.(name, value)
  }

  function compile(type, source) {
    const s = gl.createShader(type)
    gl.shaderSource(s, source)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const m = gl.getShaderInfoLog(s)
      gl.deleteShader(s)
      throw Error(m)
    }
    return s
  }

  function initGL() {
    try {
      gl = cosmos.getContext('webgl', {
        alpha: false, antialias: false, depth: false, stencil: false,
        powerPreference: 'high-performance',
      })
      if (!gl) throw Error('WebGL unavailable')
      let source = FRAGMENT_SHADER
      // 低精度设备上退到 mediump，否则整段片元直接编译不过
      if (!gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision) {
        source = source.replace('precision highp float', 'precision mediump float')
      }
      const v = compile(gl.VERTEX_SHADER, VERTEX_SHADER)
      const f = compile(gl.FRAGMENT_SHADER, source)
      program = gl.createProgram()
      gl.attachShader(program, v)
      gl.attachShader(program, f)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program))
      gl.deleteShader(v)
      gl.deleteShader(f)
      gl.useProgram(program)
      const b = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, b)
      gl.bufferData(gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
      const a = gl.getAttribLocation(program, 'aPosition')
      gl.enableVertexAttribArray(a)
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0)
      for (const k of ['uResolution', 'uPointer', 'uTime', 'uWarp', 'uMobile', 'uEnergy']) {
        uniforms[k] = gl.getUniformLocation(program, k)
      }
      cosmos.style.display = 'block'
      scene.dataset.renderer = 'webgl'
    } catch (error) {
      // 拿不到 WebGL 就退回纯 CSS 的静态黑洞，页面依然可用
      gl = null
      cosmos.style.display = 'none'
      scene.dataset.renderer = 'css'
      console.warn('Procedural fallback:', error.message)
    }
  }

  function sizeGL() {
    const d = Math.min(window.devicePixelRatio || 1, 1.5) * resolutionScale
    const cap = Math.min(1, Math.sqrt(1150000 / (w * h * d * d)))
    cosmos.width = Math.max(1, Math.round(w * d * cap))
    cosmos.height = Math.max(1, Math.round(h * d * cap))
    if (gl) gl.viewport(0, 0, cosmos.width, cosmos.height)
  }

  function resize() {
    w = scene.clientWidth
    h = scene.clientHeight
    mobile = w < 650
    sizeGL()
    const d = Math.min(window.devicePixelRatio || 1, 2)
    flight.width = Math.round(w * d)
    flight.height = Math.round(h * d)
    if (ctx) ctx.setTransform(d, 0, 0, d, 0, 0)
    if (hud) {
      const r = hud.getBoundingClientRect()
      const b = scene.getBoundingClientRect()
      hudBounds = { x: r.left - b.left, y: r.top - b.top, width: r.width }
    }
    particles = []
    shipTrail = []
    requestDraw()
  }

  function hole() {
    const fit = Math.min(1, (w / h) * 1.385)
    const radius = h * 0.259 * fit * (1 + (reduced ? 0 : warp) * 0.24)
    return {
      x: w * 0.52 + px * h * 0.004 * fit,
      y: h * (mobile ? 0.40 : 0.44) - py * h * 0.004 * fit,
      r: radius,
    }
  }

  // 开普勒方程给出真实的椭圆轨道速度变化；投影、侧倾、受光都取自同一条瞬时轨迹
  function orbit(dt, c) {
    const eccentricity = 0.38
    const a = c.r * 2.22 * (1 - warp * 0.90)
    const b = a * Math.sqrt(1 - eccentricity * eccentricity)
    const n = (2 * Math.PI) / 68
    phase += reduced ? 0 : dt * n * (1 + warp * 7)
    const M = phase % (2 * Math.PI)
    let E = M
    for (let i = 0; i < 5; i++) {
      E -= (E - eccentricity * Math.sin(E) - M) / (1 - eccentricity * Math.cos(E))
    }
    const rate = (n * (1 + warp * 7)) / (1 - eccentricity * Math.cos(E))
    const ox = a * (Math.cos(E) - eccentricity)
    const oy = b * Math.sin(E) * 0.72
    const vx = -a * Math.sin(E) * rate
    const vy = b * Math.cos(E) * 0.72 * rate
    const rotation = -0.30
    const co = Math.cos(rotation)
    const si = Math.sin(rotation)
    const x = c.x + ox * co - oy * si
    const y = c.y + ox * si + oy * co
    const ux = vx * co - vy * si
    const uy = vx * si + vy * co
    const distance = Math.hypot(x - c.x, y - c.y)
    const depth = Math.sin(E)
    const behind = depth < 0
    const visible = (behind ? ease(c.r * 0.99, c.r * 1.08, distance) : 1) *
      (busy ? ease(c.r * 0.56, c.r * 0.92, distance) : 1)
    return { x, y, vx: ux, vy: uy, distance, depth, visible, a, n }
  }

  function emit(s, c, dt) {
    if (reduced || s.visible < 0.1) return
    emitBudget += dt * (12 + warp * 35)
    while (emitBudget >= 1 && particles.length < 180) {
      emitBudget--
      const speed = Math.hypot(s.vx, s.vy) || 1
      const tangentX = s.vx / speed
      const tangentY = s.vy / speed
      particles.push({
        x: s.x - tangentX * 8, y: s.y - tangentY * 8,
        oldX: s.x, oldY: s.y,
        vx: s.vx * 0.38 - tangentX * (8 + rand() * 16) + (rand() - 0.5) * 5,
        vy: s.vy * 0.38 - tangentY * (8 + rand() * 16) + (rand() - 0.5) * 5,
        life: 0, max: 3 + rand() * 5, size: 0.2 + rand() * 0.55,
      })
    }
  }

  function renderFlight(dt) {
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    const c = hole()
    const s = orbit(dt, c)
    emit(s, c, dt)
    const mu = s.n * s.n * Math.pow(c.r * 2.22, 3) * 1.7

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]
      p.life += dt
      const dx = c.x - p.x
      const dy = c.y - p.y
      const d = Math.hypot(dx, dy)
      if (p.life > p.max || d < c.r * 0.97) { particles.splice(i, 1); continue }
      p.oldX = p.x
      p.oldY = p.y
      const force = mu / Math.max(d * d, 100)
      p.vx += (dx / d * force + (c.y - p.y) * 0.015) * dt
      p.vy += dy / d * force * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      const alpha = Math.pow(1 - p.life / p.max, 1.8) * 0.24
      ctx.strokeStyle = `rgba(226,211,183,${alpha})`
      ctx.lineWidth = p.size
      const stretch = 1 + (c.r / d) * 8 + warp * 10
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x - (p.x - p.oldX) * stretch, p.y - (p.y - p.oldY) * stretch)
      ctx.stroke()
    }

    if (!reduced && frames % 3 === 0) {
      shipTrail.push({ x: s.x, y: s.y, visibility: s.visible })
      if (shipTrail.length > 40) shipTrail.shift()
    }
    for (let i = 1; i < shipTrail.length; i++) {
      const q = shipTrail[i]
      const p = shipTrail[i - 1]
      if (q.visibility < 0.1 || p.visibility < 0.1) continue
      ctx.strokeStyle = `rgba(170,169,155,${(i / shipTrail.length) ** 2 * 0.045})`
      ctx.lineWidth = 0.7
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()
    }

    if (s.visible < 0.005) return

    // 投影光锥只在终端被唤醒时出现，并且跟着移动中的飞船
    if (energy > 0.1 && !busy) {
      const g = ctx.createLinearGradient(s.x, s.y, hudBounds.x, hudBounds.y)
      g.addColorStop(0, 'rgba(209,222,216,0)')
      g.addColorStop(1, `rgba(209,222,216,${energy * 0.025})`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(hudBounds.x, hudBounds.y)
      ctx.lineTo(hudBounds.x + hudBounds.width, hudBounds.y)
      ctx.closePath()
      ctx.fill()
    }

    const tangent = Math.atan2(s.vy, s.vx)
    const gravity = Math.atan2(c.y - s.y, c.x - s.x)
    const tide = Math.sin(gravity - tangent) * 0.15 * Math.pow(c.r / Math.max(s.distance, c.r), 2)
    const angle = tangent + tide + (reduced ? 0 : Math.sin(time * 2.1) * 0.009)
    const scale = clamp(c.r * 0.057, 6.5, 15) * (1 + s.depth * 0.22) * (1 - warp * 0.65)
    const pulse = reduced ? 0.8 : 0.66 + 0.2 * Math.sin(time * 13) + 0.12 * Math.sin(time * 31)
    const thrust = (0.35 + Math.pow(c.r / Math.max(s.distance, c.r), 2) * 0.65) * (1 + warp * 2)

    ctx.save()
    ctx.translate(s.x, s.y)
    ctx.rotate(angle)
    ctx.scale(scale, scale)
    ctx.globalAlpha = s.visible

    const plume = ctx.createLinearGradient(-0.85, 0, -2.5 - thrust, 0)
    plume.addColorStop(0, `rgba(225,226,216,${pulse * 0.64})`)
    plume.addColorStop(0.2, 'rgba(173,187,190,.18)')
    plume.addColorStop(1, 'rgba(147,170,176,0)')
    ctx.fillStyle = plume
    ctx.beginPath()
    ctx.moveTo(-0.74, -0.16)
    ctx.quadraticCurveTo(-1.8, -0.16, -2.8 - thrust, -Math.sin(gravity - angle) * 0.7)
    ctx.quadraticCurveTo(-1.8, 0.15, -0.74, 0.16)
    ctx.fill()

    // 低伏的 Ranger 侧影，朝向吸积盘的一侧偏暖
    ctx.fillStyle = '#050608'
    ctx.strokeStyle = '#d4bea082'
    ctx.lineWidth = 0.045
    ctx.beginPath()
    ctx.moveTo(1.13, 0)
    ctx.lineTo(0.42, -0.29)
    ctx.lineTo(-0.95, -0.61)
    ctx.lineTo(-0.73, -0.15)
    ctx.lineTo(-0.91, 0)
    ctx.lineTo(-0.73, 0.15)
    ctx.lineTo(-0.95, 0.61)
    ctx.lineTo(0.42, 0.29)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    const lighting = ctx.createLinearGradient(0, -0.5, 0, 0.5)
    lighting.addColorStop(0, '#8e847366')
    lighting.addColorStop(0.4, '#302e2988')
    lighting.addColorStop(1, '#080b10')
    ctx.fillStyle = lighting
    ctx.beginPath()
    ctx.moveTo(1.13, 0)
    ctx.lineTo(0.32, -0.20)
    ctx.lineTo(-0.66, -0.18)
    ctx.lineTo(-0.54, 0)
    ctx.lineTo(-0.66, 0.18)
    ctx.lineTo(0.32, 0.20)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = '#020407'
    ctx.beginPath()
    ctx.moveTo(0.62, 0)
    ctx.lineTo(0.18, -0.13)
    ctx.lineTo(-0.12, -0.11)
    ctx.lineTo(0.0, 0.10)
    ctx.lineTo(0.18, 0.13)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = '#edd8b799'
    ctx.lineWidth = 0.035
    ctx.beginPath()
    ctx.moveTo(0.96, -0.04)
    ctx.lineTo(0.38, -0.27)
    ctx.lineTo(-0.95, -0.61)
    ctx.stroke()

    ctx.strokeStyle = `rgba(221,232,232,${pulse * 0.7})`
    ctx.lineWidth = 0.055
    ctx.beginPath()
    ctx.moveTo(-0.77, -0.12)
    ctx.lineTo(-0.77, 0.12)
    ctx.stroke()
    ctx.restore()
  }

  function renderSky() {
    if (!gl || !program || gl.isContextLost()) return
    gl.uniform2f(uniforms.uResolution, cosmos.width, cosmos.height)
    gl.uniform2f(uniforms.uPointer, px, py)
    gl.uniform1f(uniforms.uTime, time)
    gl.uniform1f(uniforms.uWarp, reduced ? 0 : warp)
    gl.uniform1f(uniforms.uMobile, mobile ? 1 : 0)
    gl.uniform1f(uniforms.uEnergy, energy)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  function draw(now) {
    const delta = last ? Math.min((now - last) / 1000, 0.06) : 0
    last = now
    const dt = reduced ? 0 : delta
    time += dt
    frames++
    const blend = reduced ? 1 : 1 - Math.exp(-delta * 2.5)
    px += (tx - px) * blend
    py += (ty - py) * blend

    const focus = hud
      ? hud.contains(document.activeElement) || hud.matches(':hover')
      : false
    energy += ((focus ? 1 : 0) - energy) * (reduced ? 1 : blend)

    if (busy) {
      const progress = clamp((now - launchAt) / 4700, 0, 1)
      warp = ease(0.12, 1, progress)
      if (progressRing) progressRing.style.strokeDashoffset = String(132 * (1 - progress))
    }

    renderSky()
    renderFlight(dt)

    if (frames % 30 === 0) {
      setFlag('quiet', !reduced && !focus && !busy && now - quietAt > 6500)
    }
    // 掉帧太多就降分辨率，避免整页卡死
    if (delta > 0.038 && frames > 45) slow++
    else slow = Math.max(0, slow - 1)
    if (slow > 45 && resolutionScale > 0.54) {
      resolutionScale *= 0.8
      sizeGL()
      slow = 0
    }
  }

  function tick(now) {
    raf = 0
    if (disposed || document.hidden) return
    draw(now)
    if (!reduced || busy) raf = requestAnimationFrame(tick)
  }

  function requestDraw() {
    if (disposed || raf || document.hidden) return
    last = 0
    raf = requestAnimationFrame(tick)
  }

  const wake = () => {
    quietAt = performance.now()
    setFlag('quiet', false)
    requestDraw()
  }

  // ---- 事件（dispose 里逐个摘掉）----
  const onPointerMove = (e) => {
    wake()
    if (reduced || e.pointerType === 'touch') return
    tx = (e.clientX / w) * 2 - 1
    ty = 1 - (e.clientY / h) * 2
  }
  const onPointerLeave = () => { tx = 0; ty = 0 }
  const onVisibility = () => requestDraw()
  const onMotionChange = (e) => { reduced = e.matches; tx = 0; ty = 0; wake() }
  const onContextLost = (e) => { e.preventDefault(); cosmos.style.display = 'none' }
  const onContextRestored = () => { initGL(); sizeGL(); requestDraw() }

  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerdown', wake, { passive: true })
  document.addEventListener('pointerleave', onPointerLeave)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('resize', resize, { passive: true })
  motion.addEventListener('change', onMotionChange)
  cosmos.addEventListener('webglcontextlost', onContextLost)
  cosmos.addEventListener('webglcontextrestored', onContextRestored)

  initGL()
  resize()

  return {
    start: requestDraw,
    resize,
    wake,

    /** 进入 / 退出穿越加速。进入时按 4700ms 把 warp 从 0.12 推到 1 */
    setEngaging(on) {
      busy = on
      if (on) {
        launchAt = performance.now()
        if (progressRing) progressRing.style.strokeDashoffset = '132'
      } else {
        warp = 0
        if (progressRing) progressRing.style.strokeDashoffset = '132'
      }
      wake()
    },

    /** 中断或收尾：清掉粒子、飞船轨迹与轨道相位，回到冷启动状态 */
    reset() {
      busy = false
      warp = 0
      particles = []
      shipTrail = []
      phase = 0.62
      emitBudget = 0
      if (progressRing) progressRing.style.strokeDashoffset = '132'
      quietAt = performance.now()
      wake()
    },

    /** 卸载：停掉 RAF 并摘掉所有监听，防止内存泄漏 */
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', wake)
      document.removeEventListener('pointerleave', onPointerLeave)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', resize)
      motion.removeEventListener('change', onMotionChange)
      cosmos.removeEventListener('webglcontextlost', onContextLost)
      cosmos.removeEventListener('webglcontextrestored', onContextRestored)
    },
  }
}
