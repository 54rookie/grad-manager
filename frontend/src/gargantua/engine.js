/**
 * Gargantua v21 渲染引擎（原生 IIFE 的无框架移植）
 *
 * 只做一件事：把黑洞、碎屑盘、飞船、彗尾与全息投影画出来。
 * 不引用 React，不认识登录业务——表单校验、真实登录、路由跳转都在 Login.jsx 里。
 *
 * 为什么拆成模块闭包而不是把变量摊进组件的 useRef：
 *  原脚本的 time / phase / particles / shipTrail / dust / holo 全都在 60fps 的
 *  循环里被改写。放进组件后即使托管在 useRef，也得把几十个 ref 在函数间传来传去；
 *  收进这个闭包等于「作用域级 useRef」——同样不触发任何 React 重绘，
 *  而且 dispose 时能一次性把状态和监听全丢掉。组件那边只需要一个 engineRef。
 *
 * v21 相对上一版移植（v6 血统）的改动，全部逐字保留、未做任何改写：
 *  1. 飞船从「2D Ranger 侧影」换成**过程化生成的 Endurance 网格**（buildEnduranceMesh），
 *     用与尾迹同一套 project3() 投影光栅化到 2D 画布上，所以机身与尾迹绝不会错位；
 *  2. 轨道从「2D 旋转椭圆」换成**真三维倾斜椭圆 + 开普勒方程**（orbit），
 *     配合真实遮挡测试 occlusion()，飞船会真的躲到黑洞后面再从左缘复出；
 *  3. 新增**环境尘埃环 + 弓形激波**（renderDust）与**彗星级尾迹**（emit + 光带）；
 *  4. 新增**全息投影呼叫**（renderHologram + summon/unsummon）：飞船掠过阴影中央时
 *     投出「是否一起探索卡冈图雅？」，船被透镜吞掉的瞬间投影立刻坍缩。
 *
 * 本文件里唯一的「死代码清理」：v21 定义了 dot3 / cross3 / len3 / norm3 四个向量
 * 小工具，但整段脚本里一次都没调用过（grep 计数各为 1，即定义处本身）。
 * 属于纯删除，不影响任何一路计算。
 */
import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders'

export function createGargantua({
  cosmos, flight, scene, hud, account, progressRing,
  onFlag, onSummon, onNotify,
}) {
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
  /* 飞船起始点定在左缘复现点之前一点点：用正常轨道速率算，开页后约 1 秒就能看到
     第一次干净的露面，而不是让观者干等大半个周期 */
  const PHASE0 = (Math.PI * 33) / 34
  let phase = PHASE0
  let particles = []
  let emitBudget = 0
  let shipTrail = []
  let dust = []
  let hudBounds = { x: 0, y: 0, width: 0 }
  /* 全息投影：holo 是 0→1 的淡入淡出量，holoArmed 保证每圈只召唤一次，
     船回到左半场（P.x < -1.5）后重新上膛 */
  let holo = 0
  let holoArmed = true
  let holoOn = false
  const holoAnchor = { x: 0, y: 0 }
  let shipMesh = null
  let shipSpin = 0
  let immersed = false
  let randomState = 172911
  let disposed = false

  /* 固定种子的线性同余随机数：粒子、尘埃、全息抖动都取它。
     不用 Math.random 是为了每次加载都得到同一条轨道、同一片尘埃。 */
  const rand = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    return randomState / 4294967296
  }
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n))
  const ease = (a, b, n) => {
    const t = clamp((n - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
  }
  const TAU = Math.PI * 2

  /* quiet 每 30 帧算一次，只在真正翻转时才回调一次 —— 60fps 地往 React 里
     setState 会把渲染打爆 */
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

  // ── Endurance 飞船网格（逐字提取自 v21）──────────────────────────
  // 每个顶点 9 个浮点：位置 xyz + 法线 xyz + 颜色 rgb；每 27 个浮点是一个三角形。
  function buildEnduranceMesh() {
    const out = []
    const sub = (a, b) => a.map((x, i) => x - b[i])
    const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
    ]
    const unit = (a) => { const d = Math.hypot(...a); return a.map((x) => x / d) }
    function tri(a, b, c, color, normal) {
      const n = normal || unit(cross(sub(b, a), sub(c, a)))
      // 背面朝外的三角形直接翻过来，省掉运行时双面渲染
      if (dot(cross(sub(b, a), sub(c, a)), n) < 0) [b, c] = [c, b]
      for (const p of [a, b, c]) out.push(...p, ...n, ...color)
    }
    function quad(a, b, c, d, color, n) {
      tri(a, b, c, color, n)
      tri(a, c, d, color, n)
    }
    function box(center, half, axes, color) {
      for (let axis = 0; axis < 3; axis++) {
        for (const side of [-1, 1]) {
          const u = (axis + 1) % 3
          const v = (axis + 2) % 3
          const n = axes[axis].map((x) => x * side)
          const p = (su, sv) => center.map((x, k) =>
            x + n[k] * half[axis] + axes[u][k] * half[u] * su + axes[v][k] * half[v] * sv)
          const shade = axis === 2 ? (side > 0 ? 1 : 0.68) : 0.58
          quad(p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), color.map((x) => x * shade), n)
        }
      }
    }
    function torus(radius, tube, z) {
      const p = (a, b) => [
        Math.cos(a) * (radius + tube * Math.cos(b)),
        Math.sin(a) * (radius + tube * Math.cos(b)),
        z + tube * Math.sin(b),
      ]
      for (let i = 0; i < 48; i++) {
        for (let j = 0; j < 6; j++) {
          const a = (i * TAU) / 48
          const b = (j * TAU) / 6
          const aa = ((i + 1) * TAU) / 48
          const bb = ((j + 1) * TAU) / 6
          quad(p(a, b), p(aa, b), p(aa, bb), p(a, bb), [0.27, 0.29, 0.29])
        }
      }
    }
    const Z = [0, 0, 1]
    const XYZ = [[1, 0, 0], [0, 1, 0], Z]
    torus(0.805, 0.026, 0.075)
    torus(0.805, 0.026, -0.075)
    for (let k = 0; k < 12; k++) {
      const a = (k * TAU) / 12
      const R = [Math.cos(a), Math.sin(a), 0]
      const T = [-Math.sin(a), Math.cos(a), 0]
      const axes = [R, T, Z]
      const world = (x, y, z) => [R[0] * x + T[0] * y, R[1] * x + T[1] * y, z]
      // 十二个独立的倒角舱段拼成标志性的轮辐
      const edge = [[0.158, 0.094], [0.130, 0.122], [-0.130, 0.122], [-0.158, 0.094],
        [-0.158, -0.094], [-0.130, -0.122], [0.130, -0.122], [0.158, -0.094]]
      for (let j = 0; j < 8; j++) {
        const p = edge[j]
        const q = edge[(j + 1) % 8]
        const top = world(1 + p[0], p[1], 0.115)
        const next = world(1 + q[0], q[1], 0.115)
        const bottom = world(1 + p[0], p[1], -0.115)
        const nextBottom = world(1 + q[0], q[1], -0.115)
        tri(world(1, 0, 0.115), top, next, [0.66, 0.66, 0.62], Z)
        tri(world(1, 0, -0.115), nextBottom, bottom, [0.29, 0.31, 0.30], [0, 0, -1])
        quad(top, bottom, nextBottom, next, [0.23, 0.26, 0.26])
      }
      // 内凹面板、凸起的检修脊线，以及间隔布置的对接环
      box(world(1, 0, 0.121), [0.110, 0.084, 0.006], axes, [0.33, 0.36, 0.35])
      box(world(1, 0, 0.130), [0.127, 0.008, 0.006], axes, [0.69, 0.68, 0.63])
      for (const radialOffset of [-0.07, 0.07]) {
        box(world(1 + radialOffset, 0, 0.13), [0.004, 0.092, 0.008], axes, [0.61, 0.61, 0.57])
      }
      box(world(0.84, 0, 0), [0.075, 0.037, 0.056], axes, [0.41, 0.43, 0.40])
      box(world(0.51, 0, 0), [0.295, 0.012, 0.016], axes, [0.25, 0.28, 0.28])
      box(world(0.80, 0, 0), [0.015, 0.014, 0.09], axes, [0.43, 0.44, 0.41])
      if (k % 3 === 0) {
        box(world(1.158, 0, 0), [0.026, 0.038, 0.043], axes, [0.54, 0.54, 0.49])
        box(world(1.187, 0, 0), [0.006, 0.027, 0.027], axes, [0.14, 0.18, 0.19])
      }
      // 细长的散热缝也是几何体，不是贴图
      for (let slot = -1; slot <= 1; slot++) {
        box(world(0.96, slot * 0.043, 0.14), [0.034, 0.008, 0.003], axes, [0.08, 0.11, 0.12])
      }
    }
    // 轴向对接毂：分段环 + 不对称的设备结构
    for (let i = 0; i < 16; i++) {
      const a = (i * TAU) / 16
      const b = ((i + 1) * TAU) / 16
      const pa = [Math.cos(a) * 0.145, Math.sin(a) * 0.145, -0.13]
      const pb = [Math.cos(b) * 0.145, Math.sin(b) * 0.145, -0.13]
      const qa = [pa[0], pa[1], 0.15]
      const qb = [pb[0], pb[1], 0.15]
      quad(pa, pb, qb, qa, [0.37, 0.39, 0.37])
      tri([0, 0, 0.15], qa, qb, [0.58, 0.57, 0.51], Z)
      tri([0, 0, -0.13], pb, pa, [0.20, 0.24, 0.24], [0, 0, -1])
    }
    box([0, 0, 0.17], [0.064, 0.058, 0.036], XYZ, [0.63, 0.62, 0.57])
    box([0, 0, 0.209], [0.038, 0.037, 0.005], XYZ, [0.10, 0.16, 0.19])
    box([0.18, 0.02, 0.02], [0.075, 0.027, 0.028], XYZ, [0.40, 0.43, 0.43])
    // 下侧泊位上停着一艘紧凑的 Ranger：锥形升力体 + 座舱
    const hull = [[-0.095, -1.115, 0.11], [0.095, -1.115, 0.11], [0.058, -1.30, 0.11],
      [0.020, -1.39, 0.11], [-0.020, -1.39, 0.11], [-0.058, -1.30, 0.11]]
    for (let i = 1; i < hull.length - 1; i++) tri(hull[0], hull[i], hull[i + 1], [0.61, 0.63, 0.60], Z)
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i]
      const b = hull[(i + 1) % hull.length]
      quad(a, b, [b[0], b[1], 0.055], [a[0], a[1], 0.055], [0.19, 0.23, 0.25])
    }
    box([0, -1.26, 0.119], [0.035, 0.034, 0.005], XYZ, [0.035, 0.075, 0.10])
    return new Float32Array(out)
  }

  function sizeGL() {
    const d = Math.min(window.devicePixelRatio || 1, 1.5) * resolutionScale
    const cap = Math.min(1, Math.sqrt(1150000 / (w * h * d * d)))
    cosmos.width = Math.max(1, Math.round(w * d * cap))
    cosmos.height = Math.max(1, Math.round(h * d * cap))
    if (gl) gl.viewport(0, 0, cosmos.width, cosmos.height)
  }

  /* 环境尘埃环：半径 2.7~10.2 施瓦西半径之间撒一把尘埃，每颗记一个三维位移向量 */
  function seedDust() {
    dust = []
    const count = Math.min(260, Math.round((w * h) / 9000))
    for (let i = 0; i < count; i++) {
      const r = 2.7 + Math.pow(rand(), 1.6) * 7.5
      dust.push({
        r, a: rand() * Math.PI * 2, y: (rand() - 0.5) * (0.12 + r * 0.045),
        size: 0.35 + rand() * 0.9, tw: rand() * Math.PI * 2,
        dx: 0, dy: 0, dz: 0,
      })
    }
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
    seedDust()
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

  // ── 三维场景坐标系 ────────────────────────────────────────────────
  // 与着色器同一套几何：相机在 (0, CAM_Y, CAM_Z)，tan(8°) ≈ 1.97/14。
  // 飞船与尘埃的坐标单位都是施瓦西半径；半径为 2.6 rs 的阴影映射到屏幕上的 c.r 像素。
  const CAM_Y = 1.97
  const CAM_Z = -14
  const CAM_TILT = Math.atan2(CAM_Y, -CAM_Z)
  const COS_T = Math.cos(CAM_TILT)
  const SIN_T = Math.sin(CAM_TILT)

  function project3(P, c) {
    const pxr = c.r / 2.6
    const vy = P.y * COS_T + P.z * SIN_T
    return { x: c.x + P.x * pxr, y: c.y - vy * pxr }
  }

  /* 真正的遮挡测试，沿「相机 → P」这一段：
     ① 与原点最近距离 < 2.6 rs → 被事件视界挡住；
     ② 这一段在发光环内穿过盘面 → 被吸积盘远侧挡住（透镜会把盘面画到上面去）。 */
  function occlusion(P) {
    const vx = P.x
    const vy = P.y - CAM_Y
    const vz = P.z - CAM_Z
    const len2 = vx * vx + vy * vy + vz * vz || 1e-6
    const t = clamp(-(CAM_Y * vy + CAM_Z * vz) / len2, 0, 1)
    const dMin = Math.hypot(vx * t, CAM_Y + vy * t, CAM_Z + vz * t)
    let alpha = ease(2.58, 3.02, dMin)
    const tc = CAM_Y / (CAM_Y - P.y)
    if (tc > 0 && tc < 1) {
      const ix = vx * tc
      const iz = CAM_Z + vz * tc
      const rc = Math.hypot(ix, iz)
      const edge = ease(1.92, 2.55, rc) * (1 - ease(8.5, 12.5, rc))
      alpha *= 1 - edge
    }
    return alpha
  }

  /* 把 Endurance 画进与光晕、尾迹同一张 2D 画布：每个三角形都走 project3()，
     也就是尾迹用的那套投影，所以机壳不可能从自己的尾巴上漂走。 */
  function renderStarship(s, c, dt) {
    if (!shipMesh) shipMesh = buildEnduranceMesh()
    shipSpin += reduced ? 0 : dt * 0.6
    const visibility = s.visible * (1 - warp * 0.9)
    if (visibility < 0.005) return

    // 局部 x 沿速度方向、局部 z 是轮面法线 —— 这样不用第二套相机也能得到
    // 稳定、缓慢自转的舷侧视角
    const P = s.P
    const V = s.V
    let fx = V.x
    let fy = V.y
    let fz = V.z
    const fl = Math.hypot(fx, fy, fz) || 1
    fx /= fl; fy /= fl; fz /= fl
    let rx = fy
    let ry = -fx
    let rz = 0 // 相机上方向与运动方向叉乘得到的种子
    let rl = Math.hypot(rx, ry, rz)
    if (rl < 1e-4) {
      rx = 0; ry = fz; rz = -fy
      rl = Math.hypot(rx, ry, rz) || 1
    }
    rx /= rl; ry /= rl; rz /= rl
    // 轮面上方向 = forward × right；这组基由构造保证正交归一
    const wx = ry * fz - rz * fy
    const wy = rz * fx - rx * fz
    const wz = rx * fy - ry * fx
    // v17：让轮子绕自己的速度轴滚转。没有这一步时，轮面张在（前向, 世界上方）上，
    // 也就是一个竖直平面，而抬高的相机会永远正对着它看成一条线。
    // 一个基础滚转角 + 缓慢摆动，让它相对盘面始终有倾角，并在每圈的一段里整个展开。
    const roll = reduced ? 0.45 : 0.25 + 0.45 * Math.sin(phase * 1.5)
    const rollC = Math.cos(roll)
    const rollS = Math.sin(roll)
    // 绕前向滚转之后：网格内的「上」→ u，环轴 → a
    const ux = wx * rollC - rx * rollS
    const uy = wy * rollC - ry * rollS
    const uz = wz * rollC - rz * rollS
    const ax = rx * rollC + wx * rollS
    const ay = ry * rollC + wy * rollS
    const az = rz * rollC + wz * rollS
    const cs = Math.cos(shipSpin)
    const sn = Math.sin(shipSpin)
    const size = 0.055 * (14 / s.distCam) // 0.055 rs / 网格单位：整艘船不过十分之一个半径
    const m = shipMesh
    const tris = []
    let lx = -P.x
    let ly = -1
    let lz = -P.z
    const ll = Math.hypot(lx, ly, lz) || 1
    lx /= ll; ly /= ll; lz /= ll

    for (let i = 0; i < m.length; i += 27) {
      const sx = [0, 0, 0]
      const sy = [0, 0, 0]
      let depth = 0
      let nx = 0
      let ny = 0
      let nz = 0
      let cr = 0
      let cg = 0
      let cb = 0
      for (let j = 0; j < 3; j++) {
        const b = i + j * 9
        const x = m[b]
        const y = m[b + 1]
        const z = m[b + 2]
        const xs = x * cs - y * sn
        const ys = x * sn + y * cs
        const wvx = P.x + size * (xs * fx + ys * ux + z * ax)
        const wvy = P.y + size * (xs * fy + ys * uy + z * ay)
        const wvz = P.z + size * (xs * fz + ys * uz + z * az)
        const sp = project3({ x: wvx, y: wvy, z: wvz }, c)
        sx[j] = sp.x
        sy[j] = sp.y
        depth += Math.hypot(wvx, wvy - CAM_Y, wvz - CAM_Z)
        if (j === 0) {
          const mx = m[b + 3]
          const my = m[b + 4]
          const mz = m[b + 5]
          const mxs = mx * cs - my * sn
          const mys = mx * sn + my * cs
          nx = mxs * fx + mys * ux + mz * ax
          ny = mxs * fy + mys * uy + mz * ay
          nz = mxs * fz + mys * uz + mz * az
          cr = m[b + 6]
          cg = m[b + 7]
          cb = m[b + 8]
        }
      }
      depth /= 3
      if ((sx[0] < -8 && sx[1] < -8 && sx[2] < -8) || (sx[0] > w + 8 && sx[1] > w + 8 && sx[2] > w + 8) ||
          (sy[0] < -8 && sy[1] < -8 && sy[2] < -8) || (sy[0] > h + 8 && sy[1] > h + 8 && sy[2] > h + 8)) continue
      const area = Math.abs((sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0])) / 2
      if (area < 0.05) continue
      const nl = Math.hypot(nx, ny, nz) || 1
      nx /= nl; ny /= nl; nz /= nl
      const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz)
      let vxx = -P.x
      let vyy = CAM_Y - P.y
      let vzz = CAM_Z - P.z
      const vl = Math.hypot(vxx, vyy, vzz) || 1
      vxx /= vl; vyy /= vl; vzz /= vl
      const rim = Math.pow(Math.max(0, 1 - Math.abs(nx * vxx + ny * vyy + nz * vzz)), 3)
      const shade = 0.16 + diffuse * 0.88
      tris.push({
        d: depth,
        x0: sx[0], y0: sy[0], x1: sx[1], y1: sy[1], x2: sx[2], y2: sy[2],
        r: Math.min(255, (cr * shade + rim * 0.26) * 255) | 0,
        g: Math.min(255, (cg * shade + rim * 0.20) * 255) | 0,
        b: Math.min(255, (cb * shade + rim * 0.13) * 255) | 0,
      })
    }
    tris.sort((a, b) => b.d - a.d)
    const comaR = 5.5 + warp * 3.5
    const coma = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, comaR)
    coma.addColorStop(0, `rgba(255,238,210,${0.25 * visibility})`)
    coma.addColorStop(0.45, `rgba(255,204,148,${0.085 * visibility})`)
    coma.addColorStop(1, 'rgba(255,196,130,0)')
    ctx.fillStyle = coma
    ctx.beginPath()
    ctx.arc(s.x, s.y, comaR, 0, TAU)
    ctx.fill()
    ctx.save()
    ctx.globalAlpha = visibility
    for (const t of tris) {
      ctx.fillStyle = `rgb(${t.r},${t.g},${t.b})`
      ctx.beginPath()
      ctx.moveTo(t.x0, t.y0)
      ctx.lineTo(t.x1, t.y1)
      ctx.lineTo(t.x2, t.y2)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  // ── 全息投影呼叫 ──────────────────────────────────────────────────
  // 冷青色投影（对着琥珀色的盘面才读得出是「技术」而不是盘面物质），
  // 从船体发射出去。v21 比 v20 更早、也更平静：出现在轮子越过阴影中央时，
  // 缓慢呼吸而不是频闪，并且船被透镜吞掉的瞬间就坍缩。
  function rrect(x, y, rw, rh, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + rw, y, x + rw, y + rh, r)
    ctx.arcTo(x + rw, y + rh, x, y + rh, r)
    ctx.arcTo(x, y + rh, x, y, r)
    ctx.arcTo(x, y, x + rw, y, r)
    ctx.closePath()
  }

  function renderHologram() {
    if (holo < 0.015) return
    // 锚在船体最后一次清晰可见的位置上，所以船本身被透镜吞掉之后，
    // 投影仍然悬在原处
    const ax = holoAnchor.x
    const ay = holoAnchor.y
    const pw = 254
    const ph = 96
    const hx = clamp(ax + 30, 12, w - pw - 12)
    const hy = clamp(ay - ph - 36, 12, h - ph - 12)
    // 缓慢的全息呼吸（周期约 4~8 秒）替代原来的频闪；故障变成罕见、短暂的事件
    const flick = 0.84 + 0.16 * Math.sin(time * 5.1) * Math.sin(time * 1.7)
    const glitch = Math.sin(time * 1.9) > 0.99 ? (rand() - 0.5) * 5 : 0
    const a = holo * flick
    ctx.save()
    // 从发射点打向面板底部的投影光锥
    const bg = ctx.createLinearGradient(ax, ay, hx + 30, hy + ph)
    bg.addColorStop(0, `rgba(188,226,255,${0.30 * a})`)
    bg.addColorStop(1, 'rgba(188,226,255,0)')
    ctx.strokeStyle = bg
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(hx + 22, hy + ph - 6)
    ctx.moveTo(ax, ay)
    ctx.lineTo(hx + pw * 0.55, hy + ph - 6)
    ctx.stroke()
    // 船最后一次露面的位置上，发射环还在脉动
    ctx.strokeStyle = `rgba(200,232,255,${0.4 * a})`
    ctx.beginPath()
    ctx.arc(ax, ay, 7 + 2.5 * Math.sin(time * 2.6), 0, TAU)
    ctx.stroke()
    ctx.translate(glitch, 0)
    // 面板主体：深色半透明底衬，保证投影压在盘面最亮处也读得清
    ctx.fillStyle = `rgba(5,10,17,${0.52 * a})`
    rrect(hx, hy, pw, ph, 7)
    ctx.fill()
    ctx.fillStyle = `rgba(116,186,236,${0.09 * a})`
    ctx.strokeStyle = `rgba(168,220,255,${0.6 * a})`
    ctx.lineWidth = 1
    rrect(hx, hy, pw, ph, 7)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = `rgba(160,214,255,${0.05 * a})`
    for (let y = hy + 5; y < hy + ph - 4; y += 3) ctx.fillRect(hx + 4, y, pw - 8, 1)
    ctx.strokeStyle = `rgba(214,240,255,${0.85 * a})`
    const cb = (cx, cy, dx, dy) => {
      ctx.beginPath()
      ctx.moveTo(cx + dx * 10, cy)
      ctx.lineTo(cx, cy)
      ctx.lineTo(cx, cy + dy * 10)
      ctx.stroke()
    }
    cb(hx + 1.5, hy + 1.5, 1, 1)
    cb(hx + pw - 1.5, hy + 1.5, -1, 1)
    cb(hx + 1.5, hy + ph - 1.5, 1, -1)
    cb(hx + pw - 1.5, hy + ph - 1.5, -1, -1)
    // 标题与两行副标题
    ctx.font = '600 15px "PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif'
    ctx.fillStyle = `rgba(219,240,255,${0.96 * a})`
    ctx.shadowColor = `rgba(150,210,255,${0.8 * a})`
    ctx.shadowBlur = 9
    ctx.fillText('是否一起探索卡冈图雅？', hx + 17, hy + 34)
    ctx.shadowBlur = 0
    ctx.font = '10px "Helvetica Neue","PingFang SC",sans-serif'
    ctx.fillStyle = `rgba(168,216,250,${0.72 * a})`
    ctx.fillText('ENDURANCE 呼叫 · 接入终端即可同行', hx + 17, hy + 55)
    ctx.font = '11px "PingFang SC","Helvetica Neue",sans-serif'
    ctx.fillStyle = `rgba(255,228,175,${(0.45 + 0.45 * Math.sin(time * 2.2)) * a})`
    ctx.fillText('▼ 请在下方输入账号与密码', hx + 17, hy + 76)
    ctx.restore()
  }

  /* 开普勒方程给出真实的三维椭圆轨道速度变化。轨道相对盘面倾斜约 11.5°，
     于是飞船有时贴着盘面上方掠过、有时俯冲进黑洞背后再从左侧复出。 */
  function orbit(dt, c) {
    // 近侧那一段要保持在盘面上方一点点：v6 里正的倾角会把这一段压到合成环后面，
    // 飞船的世界坐标明明在相机与黑洞之间，屏幕上却会提前消失
    const eccentricity = 0.38
    const inclination = -0.06
    const a = 5.77 * (1 - warp * 0.90)
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
    const oz = b * Math.sin(E)
    const dox = -a * Math.sin(E) * rate
    const doz = b * Math.cos(E) * rate
    const si = Math.sin(inclination)
    const ci = Math.cos(inclination)
    const P = { x: ox, y: oz * si, z: oz * ci }
    const V = { x: dox, y: doz * si, z: doz * ci }
    const s0 = project3(P, c)
    const s1 = project3({ x: P.x + V.x * 0.4, y: P.y + V.y * 0.4, z: P.z + V.z * 0.4 }, c)
    const svx = (s1.x - s0.x) / 0.4
    const svy = (s1.y - s0.y) / 0.4
    const distCam = Math.hypot(P.x, P.y - CAM_Y, P.z - CAM_Z)
    const alpha = occlusion(P)
    return { x: s0.x, y: s0.y, vx: svx, vy: svy, P, V, E, distCam, alpha, visible: alpha, n }
  }

  /* 彗星级尾迹：大量颗粒被从盘面上剥离下来，沿速度反方向甩出去，存活更久、
     拉成细长的流线，并从白热逐渐冷却成暗淡的琥珀色 */
  function emit(s, c, dt) {
    if (reduced || s.visible < 0.1) return
    emitBudget += dt * (26 + warp * 60)
    while (emitBudget >= 1 && particles.length < 420) {
      emitBudget--
      const speed = Math.hypot(s.vx, s.vy) || 1
      const tangentX = s.vx / speed
      const tangentY = s.vy / speed
      particles.push({
        x: s.x - tangentX * 6, y: s.y - tangentY * 6,
        oldX: s.x, oldY: s.y,
        vx: s.vx * 0.45 - tangentX * (18 + rand() * 34) + (rand() - 0.5) * 7,
        vy: s.vy * 0.45 - tangentY * (18 + rand() * 34) + (rand() - 0.5) * 7,
        life: 0, max: 4.5 + rand() * 6, size: 0.25 + rand() * 0.8,
      })
    }
  }

  /* 环境尘埃环 + 弓形激波：每颗尘埃记一个三维位移向量，飞船把它推出去、
     它再慢慢弹回来，读起来就是一圈涟漪 / 弓形激波扫过尘埃场。 */
  function renderDust(dt, c, s) {
    const shipSpeed = Math.hypot(s.vx, s.vy)
    const periBoost = Math.pow(5 / (Math.hypot(s.P.x, s.P.y, s.P.z) + 1), 2)
    const R = 2.1 + warp * 1.6 + periBoost * 0.9
    const push = (s.visible > 0.03 ? 1 : 0) * (1.6 + shipSpeed * 0.02) * (0.5 + periBoost * 2.2)
    for (const p of dust) {
      if (!reduced) p.a += dt * (1 + warp * 6) * 9 / Math.pow(p.r, 1.5)
      const bx = Math.cos(p.a) * p.r
      const bz = Math.sin(p.a) * p.r
      if (push > 0) {
        const rx = bx - s.P.x
        const ry = p.y - s.P.y
        const rz = bz - s.P.z
        const d = Math.hypot(rx, ry, rz)
        if (d < R && d > 0.05) {
          const f = (1 - d / R) * (1 - d / R) * push * dt
          p.dx += rx / d * f
          p.dy += ry / d * f * 0.7
          p.dz += rz / d * f
        }
      }
      const decay = reduced ? 0 : Math.exp(-dt * 1.5)
      p.dx *= decay
      p.dy *= decay
      p.dz *= decay
      const P = { x: bx + p.dx, y: p.y + p.dy, z: bz + p.dz }
      const sp = project3(P, c)
      if (sp.x < -20 || sp.x > w + 20 || sp.y < -20 || sp.y > h + 20) continue
      const occl = occlusion(P)
      if (occl < 0.02) continue
      const dispMag = Math.hypot(p.dx, p.dy, p.dz)
      const shock = Math.min(1, dispMag * 2.4)
      const twinkle = 0.55 + 0.45 * Math.sin(time * 2.2 + p.tw)
      const alpha = (0.05 + 0.10 * twinkle + shock * 0.30) * occl
      const depth = clamp(14 / Math.hypot(P.x, P.y - CAM_Y, P.z - CAM_Z), 0.55, 1.5)
      // 沿局部轨道切线拉成流线；被激波扫到的尘埃烧得更亮
      const tv = 3 / Math.sqrt(p.r)
      const txv = -Math.sin(p.a) * tv
      const tzv = Math.cos(p.a) * tv
      const sp2 = project3({ x: P.x + txv * 0.09, y: P.y, z: P.z + tzv * 0.09 }, c)
      const stretch = 1 + shock * 3.5 + warp * 2
      ctx.strokeStyle = shock > 0.15
        ? `rgba(255,214,160,${alpha})`
        : `rgba(255,232,200,${alpha})`
      ctx.lineWidth = p.size * depth * (1 + shock)
      ctx.beginPath()
      ctx.moveTo(sp.x, sp.y)
      ctx.lineTo(sp.x + (sp.x - sp2.x) * stretch, sp.y + (sp.y - sp2.y) * stretch)
      ctx.stroke()
    }
  }

  function renderFlight(dt) {
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    const c = hole()
    const s = orbit(dt, c)
    // 当轮子在前侧掠过阴影中央时触发召唤（偏近点角 5.1 rad，距右缘俯冲约 9 秒，
    // 比 v20 早约 5 秒）。只要船还看得见，投影就跟着它；一旦被透镜吞掉立刻坍缩。
    const diving = s.E > 5.1 && s.E < 6.25
    if (!reduced && !busy && holoArmed && diving && s.visible > 0.5) {
      holoArmed = false
      holoOn = true
      summon()
    }
    if (s.P.x < -1.5) holoArmed = true
    if (busy || reduced) holoOn = false
    const wantHolo = holoOn && s.visible > 0.3
    holo += ((wantHolo ? 1 : 0) - holo) * (1 - Math.exp(-dt * (wantHolo ? 3.2 : 7)))
    if (s.visible > 0.25) {
      holoAnchor.x = s.x
      holoAnchor.y = s.y
    }
    if (holo < 0.02 && !wantHolo) {
      if (holoOn) unsummon()
      holoOn = false
    }
    renderDust(dt, c, s)
    emit(s, c, dt)
    const svis = s.visible * (1 - warp * 0.9)
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
      const t = p.life / p.max
      const alpha = Math.pow(1 - t, 1.8) * 0.30
      // 靠近彗核是白热的，沿尾巴一路冷却成暗淡的琥珀色
      const cr = Math.round(255)
      const cg = Math.round(236 - 66 * t)
      const cb = Math.round(200 - 92 * t)
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`
      ctx.lineWidth = p.size
      const stretch = 1 + (c.r / d) * 10 + warp * 12
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x - (p.x - p.oldX) * stretch, p.y - (p.y - p.oldY) * stretch)
      ctx.stroke()
    }
    // 彗星拖带：船体被遮住时也要继续采样轨道。上一版在这里因为可见度归零就
    // 提前 return，导致最后一段尾巴僵在屏幕上，直到飞船复出才更新。
    if (!reduced && frames % 2 === 0) {
      const previous = shipTrail[shipTrail.length - 1]
      // resize 或大跳帧把发射点瞬移了的话，另起一段，而不是横穿整个视口画一条对角线
      if (!previous || Math.hypot(s.x - previous.x, s.y - previous.y) < 90) {
        shipTrail.push({ x: s.x, y: s.y, vis: svis })
      } else {
        shipTrail.push({ x: s.x, y: s.y, vis: 0, break: true })
      }
      if (shipTrail.length > 150) shipTrail.shift()
    }
    if (shipTrail.length > 1) {
      ctx.globalCompositeOperation = 'lighter'
      const n = shipTrail.length
      const passes = [[9, '255,190,120', 0.045], [4, '255,214,160', 0.085], [1.4, '255,240,214', 0.20]]
      for (const [width, color, base] of passes) {
        ctx.lineWidth = width
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        for (let i = 1; i < n; i++) {
          const q = shipTrail[i]
          const pr = shipTrail[i - 1]
          if (q.break || pr.break) continue
          const age = (i / n) ** 2
          const alpha = base * age * Math.min(q.vis, pr.vis)
          if (alpha < 0.004) continue
          ctx.strokeStyle = `rgba(${color},${alpha})`
          ctx.beginPath()
          ctx.moveTo(pr.x, pr.y)
          ctx.lineTo(q.x, q.y)
          ctx.stroke()
        }
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    // 船体被透镜吞掉之后，全息投影还要继续闪烁（并淡出），
    // 所以它画在可见度提前 return 之前
    renderHologram()
    if (svis < 0.005) return
    // 只有终端被唤醒时才有投影光锥，并且它跟着移动中的发射点
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
    // 彗核：网格本身只有尘埃大小，所以用一个热加色光晕来标出飞船的位置 ——
    // 整条尾巴都是从这个亮头里流出来的
    const pulse = reduced ? 0.8 : 0.7 + 0.18 * Math.sin(time * 13) + 0.1 * Math.sin(time * 31)
    const glowR = clamp(c.r * 0.09, 10, 46) * (1 + warp * 1.2)
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR)
    g.addColorStop(0, `rgba(255,246,226,${0.55 * pulse * svis})`)
    g.addColorStop(0.35, `rgba(255,214,150,${0.22 * pulse * svis})`)
    g.addColorStop(1, 'rgba(255,190,120,0)')
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(s.x, s.y, glowR, 0, TAU)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    // 过程化生成的 Endurance 本体
    renderStarship(s, c, dt)
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

  /* v20：终端回应全息投影 —— 输入框发光、HUD 拒绝转入安静态，
     有精确指针的设备上还会把光标送进账号框 */
  function summon() {
    if (immersed) return
    onSummon?.(true)
    onNotify?.('永恒号正在呼叫 · 是否一起探索卡冈图雅', 4500)
    wake()
    /* 原版只在「有精确指针 + 非沉浸」时抢焦点。这里多一道闸：表单里已经有焦点
       （用户正在输入）时不抢。示范页上抢焦点只是演示效果，但这是真登录页——
       正在敲密码时被拽回账号框，会直接把凭据写错框。 */
    const typing = Boolean(hud && hud.contains(document.activeElement))
    if (!typing && window.matchMedia('(pointer:fine)').matches) {
      try { account?.focus({ preventScroll: true }) } catch { /* 焦点抢不到就算了 */ }
    }
  }

  function unsummon() {
    onSummon?.(false)
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
      // 穿越加速：4700ms 把 warp 从 0.12 推到 1。
      // ⚠ 这里故意不调用原生那份 finish() —— 什么时候放行由 Login.jsx 决定
      //（它要等真实登录请求回包），引擎只负责把特效推到底。
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
  const onFocusIn = () => wake()
  const onFocusOut = () => requestDraw()

  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerdown', wake, { passive: true })
  document.addEventListener('pointerleave', onPointerLeave)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('resize', resize, { passive: true })
  motion.addEventListener('change', onMotionChange)
  cosmos.addEventListener('webglcontextlost', onContextLost)
  cosmos.addEventListener('webglcontextrestored', onContextRestored)
  if (hud) {
    hud.addEventListener('focusin', onFocusIn)
    hud.addEventListener('focusout', onFocusOut)
  }

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
        // 起飞就掐掉全息投影（原生 submit 里同样处理）
        holo = 0
        holoOn = false
        onSummon?.(false)
        if (progressRing) progressRing.style.strokeDashoffset = '132'
      } else {
        warp = 0
        if (progressRing) progressRing.style.strokeDashoffset = '132'
      }
      wake()
    },

    /** 沉浸模式（h 键）：让 summon() 自觉地不去抢焦点 */
    setImmersed(v) { immersed = v },

    /** 中断或收尾：清掉粒子、飞船轨迹与轨道相位，回到冷启动状态 */
    reset() {
      busy = false
      warp = 0
      particles = []
      shipTrail = []
      phase = PHASE0
      emitBudget = 0
      holo = 0
      holoOn = false
      onSummon?.(false)
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
      if (hud) {
        hud.removeEventListener('focusin', onFocusIn)
        hud.removeEventListener('focusout', onFocusOut)
      }
    },
  }
}
