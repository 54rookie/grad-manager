# 研究生管理系统 · 师门手账

> 这份 README 是**交接文档**：读完它就应该能理解整个系统、并直接上手改代码。
> 如果你是 AI，请先读完「五、前端架构」和「八、已知坑」再动手。

---

## 一、这是什么

导师用的师门管理小站。两种角色：**老师**（导师，全部权限）与**学生**。

视觉是「手作手账 / 独立画册」风：纸张底色、朱砂印章、和纸胶带、虚线缝线、衬线字体。
**没有注册功能**——账号只能由老师在「账号管理」里创建发放。

| 模块 | 路由 | 可见角色 | 说明 |
|------|------|----------|------|
| 进度看板 | `/progress` | 师生（**学生只读**） | 按年级分组展示全班论文进度：**两篇论文各一条 8 节点时间轴**、完成度（手写 SVG 甜甜圈）、节点计划/实际时间、自动风险判定（四级）。老师可点选节点、改节点名、设置风险基准、手动改风险、看往返与周报并「一键催办」；学生进去是全面降级只读。**老师的默认首页** |
| 论文管理 | `/thesis` | 师生 | 多轮往返：学生提交文字+附件 → 老师批注并回传批注文件 → 学生再提交。全部留档。**上一轮未获批注时禁止开新一轮**，但可以「修改本次提交」。**学生的默认首页** |
| 每周周报 | `/reports` | 师生 | 学生每周交 Markdown 周报（可编辑/预览/历史只读）；老师按周看全班 已交/未交/逾期 并点评 |
| 问答点评 | `/qa` | 师生 | 类小红书信息流：任何人发帖、全员可见、任何人可回复 |
| 每日公告 | `/announcements` | 师生（发布仅老师） | 软木墙 + 便签，老师发布/删除 |
| 常用链接 | `/links` | 师生（维护仅老师） | 老师维护的外链按钮，新窗口打开 |
| 消息中心 | `/messages` | 师生 | 老师催办发给学生的定向消息；学生看收件箱，Banner 铃铛有未读角标 |
| 账号管理 | `/accounts` | **仅老师** | 增删改、重置密码；学生访问会被重定向到 `/thesis`。**不在主导航**，入口是 Banner 右上角的太阳 ☀ |

登录后按角色分流：老师 → `/progress`，学生 → `/thesis`
（常量 `TEACHER_HOME` / `STUDENT_HOME` 在 `App.jsx` 顶部，`<Home>` 用它俩分流）。

---

## 二、技术栈与端口

| 层 | 技术 | 端口 |
|----|------|------|
| 前端 | React 18 + Vite 5 + React Router v6；**绝大多数样式是原生 CSS**（`styles.css`），仅登录页用 CSS Modules | 5173（仅开发） |
| 后端 | FastAPI + SQLModel + SQLite（单文件库 `backend/grad_manager.db`） | **5183** |
| 认证 | JWT Bearer（python-jose），有效期 72 小时；密码用 **bcrypt 直接哈希**（⚠️ 不要用 passlib，与 bcrypt 4.x 不兼容） | — |

依赖清单：`backend/requirements.txt`、`frontend/package.json`（依赖极少，刻意不引 UI 库和图表库）。

### 两种访问方式

- **只看 5183 一个端口** → http://localhost:5183
  后端在 `frontend/dist` 存在时托管前端构建产物并做 SPA 回退，所以 5183 同时是网页和 API，`/docs` 是自动生成的 API 文档。
  ⚠️ **改完前端必须 `npm run build` 才会在 5183 生效**。
- **改前端时用 5173 开发服务器**（热更新）→ http://localhost:5173
  Vite 把 `/api/*` 代理到 5183（配置在 `frontend/vite.config.js`）。改后端端口要同步改这里并重启 dev server。

### 登录态是「每个标签页独立」的（重要）

Token 存在 **`sessionStorage`**（不是 localStorage），所以同一浏览器可以一个标签页登老师、另一个登学生。
这是刻意设计：localStorage 同源共享，两个标签页同登不同账号时后登录的会顶掉前一个，
导致「看着是老师界面、请求却带着学生身份」→ 403。
**新增代码请只用 `api.js` 导出的 `getToken/setToken/clearToken`**，不要直接碰 localStorage。

---

## 三、启动 / 重置

```bash
# 后端（依赖已装在 backend/.venv）——同时提供网页与 API
cd backend && ./.venv/bin/python -m uvicorn app.main:app --port 5183

# 前端
cd frontend && npm run dev      # 开发热更新（5173）
cd frontend && npm run build    # 构建产物给 5183 用（frontend/dist）
```

首次启动自动建表、补列、迁移旧里程碑，并写入演示数据（见下）。

> 📦 本仓库只包含应用代码。**线上部署与版本更新属于运维材料，不在仓库内**
> —— 那些步骤和具体服务器绑定，放在这里会和代码版本脱节。

**重置数据**：停掉后端，删 `backend/grad_manager.db`、`backend/grad_manager.key` 与 `backend/uploads/`，重启即可。
库为空时会按 `app/seed_snapshot.py` 重新灌一遍演示数据（见下）。

### 环境变量（部署时用得上）

| 变量 | 默认 | 说明 |
|------|------|------|
| `GM_DB_PATH` | `backend/grad_manager.db` | SQLite 库文件路径 |
| `GM_UPLOAD_DIR` | `backend/uploads` | 附件目录 |
| `GM_SECRET_KEY` | 见下 | JWT 签名密钥。**多实例部署必须显式设置并保持一致** |
| `GM_SECRET_KEY_FILE` | 数据库同目录的 `grad_manager.key` | 上面没设时，从这里读；文件不存在就自动生成一份随机密钥并持久化（权限 600） |
| `GM_DISABLE_DOCS` | 不设（即开启） | 设 `1` 关闭 `/docs`、`/redoc`、`/openapi.json`。**公网部署建议设** |
| `GM_SEED_PASSWORD` | `123456` | **建号时的**初始密码。**公网部署务必换成强密码** |

> ⚠️ **绝不要把 `SECRET_KEY` 硬编码回代码里**。仓库是公开的，拿到那串常量的人
> 可以自己签发一个 `role=teacher` 的 token 直接冒充导师登录，连密码都不需要。
> 现在改成「环境变量 → 密钥文件 → 进程内随机」三级兜底（`auth.py::_load_secret_key`），
> 本来就防的是这件事。`grad_manager.key` 已在 `.gitignore` 里，**别把它提交上去**。

**改了 `SECRET_KEY` 会让所有已登录的 token 立即失效**（签名对不上），用户重新登录即可，不影响数据。

### 演示账号

- 老师：`teacher`（曾老师，导师）
- 2024 级：`liuwenqiang` 刘文强、`liuzilong` 刘子龙、`yanglei` 杨磊
- 2025 级：`liufuqiang` 刘富强、`panyouqi` 潘有琪、`tongjian` 童健、`zhangchenghe` 张成赫
- 2026 级：`yangkang` 杨康、`xiexundong` 谢循东、`fengcheng` 冯成

**密码是「建号那一刻」写死的哈希**，之后改库里的值不会影响已有账号：

- 空库首次启动 → 全部账号的密码都是 `GM_SEED_PASSWORD`（默认 `123456`）。
- 已经有库 → 种子整体跳过，**谁的密码被改过就一直是被改过的那个**，不会因为重启而重置。
- 忘了密码 → 在「账号管理 → 编辑 → 重置密码」里改；或删库重启重新种子（**会清空所有数据**）。
- 用户自助改密码走 `POST /api/me/password`（要验原密码，新密码至少 6 位）。

### 演示数据从哪来（⚠️ v1.1 起变了，别搞混）

**三条入口、两份数据源，各管各的**：

| 入口 | 数据源 | 干什么 |
|------|--------|--------|
| `app/seed.py`（启动时自动跑） | **`app/seed_snapshot.py`** | 空库首次启动，把库灌成与导出时**完全一致**的状态 |
| `scripts/reset_students.py` | `app/demo_data.py` 的 `STUDENTS` | 按名单重建账号与空白论文项目（先删旧学生及其全部数据） |
| `scripts/seed_student_demo.py` | `app/demo_data.py` 的 `DEMO` | 给指定学生重灌往返 / 周报 / 问答（可重复执行） |

**`seed_snapshot.py` 是一份从真实数据库导出的全量快照**（约 1500 行），日期是冻结的绝对日期，
所以「空库 + 跑一次 seed」在**任何一天跑结果都一样**。想改演示数据：

```bash
# ① 先把库调成你想要的样子（跑起来点，或用脚本灌）
# ② 再重新导出快照
cd backend && ./.venv/bin/python scripts/export_seed_snapshot.py
```

> 🚫 **不要手改 `seed_snapshot.py`**——下次导出会被覆盖，而且容易和 `seed.py` 的读取方式对不上。

三处导出时**只能语义一致、无法逐字复现**的东西（脚本和快照头部都写了）：

1. **密码哈希** —— bcrypt 每次加盐不同，导出时统一记成 `INITIAL_PASSWORD`
2. **附件存储名** —— 存储名是 uuid，每次重灌都不同；但界面显示的原始文件名一致
3. **自增 id** —— 按插入顺序重新分配，关系仍然正确，数值可能不同

### 改学生名单 / 灌测试数据

**改名单**：编辑 `backend/app/demo_data.py` 里的 `STUDENTS`，然后

```bash
cd backend && ./.venv/bin/python scripts/reset_students.py
```

它会删除全部旧学生**及其论文项目、往返记录、周报、问答数据**与孤立附件，再按名单重建账号和空白论文项目。

**灌测试数据**：

```bash
cd backend && ./.venv/bin/python scripts/seed_student_demo.py   # 可重复执行，先清后写
```

`demo_data.py` 的 `DEMO` 里给 `liuwenqiang`、`liuzilong` 各准备了 1 个论文项目（含节点计划/实际时间）、
2 轮往返（第 1 轮已批注+附件、第 2 轮**待批注**）、若干周报（含老师点评，刘子龙缺一周可测「未交/逾期」）
与 1 条提问。其他人保持干净。

> `demo_data.py` 仍然管着**名单和逐条演示数据**，但**空库初始化已经不走它了**（走快照）。
> 新增测试数据往 `DEMO` 里塞；要让它出现在「空库初始状态」里，得重新导出快照（见上）。

---

## 四、目录结构

```
backend/
  app/
    main.py        # FastAPI 入口：CORS、/api/login、/api/me、/api/me/password、挂载路由、启动建库+种子、SPA 回退
    database.py    # engine、get_session、UPLOAD_DIR、ADDED_COLUMNS（缺列自动补）、_migrate_milestones（旧里程碑升级）
    models.py      # 全部 SQLModel 表 + STAGES / MILESTONE_LABELS / DEFAULT_MILESTONES
                   #   / LEGACY_LABEL_MAP / RISK_LEVELS / DEFAULT_RISK_CONFIG / upgrade_legacy_milestones
    auth.py        # JWT 密钥三级兜底、bcrypt 哈希、签发/校验、get_current_user、require_teacher
    demo_data.py   # 学生名单 GRADES/STUDENTS + 逐条测试数据 DEMO + clear_student/apply_student_demo
                   #   （⚠️ 空库初始化已不走这里，见 seed_snapshot.py）
    seed.py        # 空库首次启动写入数据 —— 读的是 seed_snapshot.py
    seed_snapshot.py  # ⭐ 从真实库导出的全量演示数据快照（绝对日期，约 1500 行，勿手改）
    routers/
      grades.py    # /api/grades、/api/users
      thesis.py    # /api/thesis/* 风险基准配置、项目、多轮往返、附件
      reports.py   # /api/reports/* 周报与点评
      misc.py      # /api/questions、/api/announcements、/api/links
      messages.py  # /api/messages 定向消息
  scripts/         # reset_students.py / seed_student_demo.py / export_seed_snapshot.py
  uploads/         # 上传附件（uuid 命名，原始文件名存库），不入库

frontend/src/
  main.jsx          # BrowserRouter > ToastProvider > AuthProvider > MessagesProvider > App
  App.jsx           # 全部路由 + 角色守卫（Guard / TeacherOnly / Home）+ TEACHER_HOME/STUDENT_HOME
  api.js            # fetch 封装：自动带 JWT、统一错误文案、401/403 处理
  auth.jsx          # AuthContext：user / loading / login / logout
  toast.jsx         # 全局 Toast：useToast()('msg','success'|'error'|'info')
  messages.jsx      # MessagesContext：未读角标 + 10s 轮询 + 回到标签页立即刷新
  banner.jsx        # BannerProvider + usePageBanner（页面声明自己标题的入口）
  GlobalBanner.jsx  # 全局聚合 Banner：品牌 / 标题 / 用户区 / 主导航 / 太阳 / 铃铛 / 鹈鹕一号
  HandDrawnSelect.jsx  # 手账风下拉筛选器（进度看板用）
  pelican.jsx       # 「海风骑行 · 鹈鹕与自行车」SVG（含 rAF 骑行动画）
  components.jsx    # 旧版共享组件（Modal / WeekSelect）
  charts.jsx        # 旧版 SVG 图表组件（新版页面已改用手写 SVG）
  styles.css        # 全局样式（见「六、样式分层」）
  gargantua/
    shaders.js      # 登录页的两段 GLSL（逐字提取，勿改）
    engine.js       # 登录页的黑洞渲染引擎（无 React，纯 JS）
  pages/
    Login.jsx / Login.module.css   # 星际穿越主题登录页
    Layout.jsx        # .pg-shell 外壳 + Banner + 全局弹窗
    Progress.jsx  Thesis.jsx  Reports.jsx
    QA.jsx  Announcements.jsx  Links.jsx  Accounts.jsx  Messages.jsx
```

---

## 五、前端架构（改代码前必读）

### 1. 路由与角色

`App.jsx` 里所有路由集中声明。`<Guard>` 负责未登录跳 `/login`；
`<TeacherOnly>` 包住仅老师可进的页面（目前只有 `/accounts`），学生访问会被送回自己的首页。
`<Home>` 按角色分流到 `/progress`（老师）或 `/thesis`（学生）。

**前端隐藏 ≠ 安全**：`Layout` 的导航项用 `teacherOnly: true` 隐藏，后端也有 `require_teacher` 兜底。
**新增老师专属功能时，前端隐藏和后端校验两处都要加。**

### 2. Banner 标题怎么传（最容易搞错的一点）

页面**不是**通过 `<GlobalBanner title=... />` 传标题的。`GlobalBanner` 只被 `BannerProvider` 渲染一次，
页面侧一律走 hook：

```jsx
// pages/Thesis.jsx 顶部有个 XxxBannerBridge 组件
function ThesisBannerBridge() {
  usePageBanner({
    title: <span>论文<span className="hl">往返批改</span>档案</span>,  // .hl 会上玫瑰色
    subtitle: '每一轮提交与批注，都被妥善收进档案册',
  })
  return null
}
```

页面里渲染一次 `<ThesisBannerBridge />` 即可。hook 在卸载时会清空标题，
所以**同一个页面不要渲染两个 bridge**。另：`.pg-gb .slot-text` 有 `min-height` 兜底，
漏传标题时 Banner 高度不会塌，但最好还是每个页面都传齐。

### 3. 全局聚合 Banner 的构成

`GlobalBanner.jsx` 的 `.pg-gb` 里：

- `.day-banner`（圆角卡片，`overflow: hidden` 用来裁云朵/光芒）
  - `.bar-top`：品牌（绝对定位在左）+ `.slot-text` 标题组（`justify-content: center` 真居中）
  - `.sun`：**老师端是 `<button class="sun sun-btn">`，点它进 `/accounts`**；学生端是纯装饰 `<span>`
    ⚠️ 它是纯装饰出身，原本带 `pointer-events: none` 且被 `.bar-top` 盖住，加交互时要同时补
    `pointer-events: auto` 和 `z-index: 4`。
  - `.main-nav`：主导航（**账号管理不在这里**）
- `.user-zone`：**刻意放在 `.day-banner` 之外**（`.pg-bb` 的直接子级），
  因为 `.day-banner` 的 `overflow: hidden` 会把向下展开的用户下拉菜单裁掉。
  定位 `top: 38px; right: 150px`（太阳左侧），`z-index: 5`。
- `.ride-a`：一号鹈鹕，挂在 `.pg-gb` 内，车轮压在 `.day-banner` 最下边缘（`bottom: calc(var(--w) * -0.035)`）

### 4. 登录态与 API 封装

`api.js` 是唯一出口：`api.get/post/put/del/postForm/putForm` + `downloadFile`。

**关键**：它把 401 分成两种——
- `/login` 自己返回的 401 = **密码错误**，原样抛后端文案（`用户名或密码错误`）给调用方；
- 其它接口的 401 = 登录态过期，清 token 并 `window.location.href = '/login'`。

⚠️ 改动这里时务必保留这个区分：否则登录页密码一错就整页重载，用户看到的会是「登录已过期」。

### 5. 消息与未读角标

`MessagesContext`（`messages.jsx`）是唯一数据源：未读数来自后端 `GET /api/messages` 的 `unread` 字段。
它 **10 秒轮询一次，并在 `visibilitychange` / `focus` 时立即刷新**。
`GlobalBanner` 的铃铛角标和 `/messages` 页面共用这一份。

注意：**老师端未读数恒为 0**——老师看到的是自己*发出*的消息，未读只对收件人有意义
（`routers/messages.py` 里按 `to_id == user.id` 过滤）。

### 6. Gargantua 登录页（`/login`）

用 WebGL 黑洞 + 2D 飞船轨道做的「星际穿越」主题页，**是唯一使用 CSS Modules 的地方**。

- `gargantua/shaders.js`：两段 GLSL 常量（从原型逐字提取，**别手改**）
- `gargantua/engine.js`：`createGargantua({cosmos, flight, scene, hud, progressRing, onFlag})`
  → `{ start, resize, wake, setEngaging, reset, dispose }`。纯 JS，不引用 React。
  所有逐帧状态（time/warp/particles/shipTrail/phase…）都在闭包里；
  `dispose()` 会 `cancelAnimationFrame` 并摘掉全部 8 个监听。
- `pages/Login.jsx`：只做三件事——把 DOM 节点交给引擎、把驱动 DOM 的状态做成 `useState`、
  接真实登录。**登录成功要等穿越动画播够 `MIN_WARP_MS`(1600ms) 再跳**，
  用 `submittingRef` 排除「已登录就送走」那个 effect 抢跑。
- 样式在 `Login.module.css`，类名会被哈希（`_universe_xxx`），**绝不污染手账风格**。
  它没有 `import` 进 `styles.css`，是组件自己 import 的。

无 WebGL 时自动降级到静态 CSS 黑洞（`scene.dataset.renderer === 'css'`），页面依然可用。

### 7. 三只鹈鹕的挂载点（改之前先看清楚）

| 鹈鹕 | 挂在哪 | 行为 |
|------|--------|------|
| `.ride-a`（最大） | `GlobalBanner.jsx` 的 `.pg-gb` 内 | 随文档滚动，车轮压在 Banner 下边缘 |
| `.ride-b` | `Progress.jsx` 的 `.chart` 内 | 贴着图表最上方那条虚线骑（`.chart::before` 的 `top:33%`） |
| `.ride-c` | `Layout.jsx` 的 `.ride-layer`（`position: fixed`） | 固定在视口，始终可见 |

⚠️ `.ride` 基类带 `pointer-events: none`（纯装饰，绝不能挡点击）。
`ride-a` 曾因为脱离 `.ride-layer` 而丢掉这个继承，骑在导航上方把点击全挡了——**别删这条**。

### 8. 进度看板的两条轨道（`Progress.jsx`，v1.1 重头戏）

毕业要求两篇论文，所以每个学生有 **2 条平行轨道 × 8 个节点 = 16 个节点**。
后端把 16 项存在一个扁平数组里，每项带 `track`（1 或 2），前端用 `byTrack()` 分成两栏渲染。

几个成文已久的约定，改之前先读懂：

- **完成度算两次**：每条轨道各自的填充比例按「该轨道最后一个已完成节点」算
  （`fillPercent`），环形甜甜圈取两条轨道的**平均值**（`overallPercent`）——只算一条会失真。
- **`actual` 优先于 `done`**：`fillPercent` 里 `isDone` 先看 `nd.actual !== undefined`，
  再回落到本地 `done` 标志（兼容还没同步回后端的乐观更新）。
- **轨内必须从左到右依次点亮**：`lockedIn()` —— 前一个节点没完成，当前节点就锁住
  （索引 0 没有前置，永远可点）。
- **不能从中间取消**：`canUncheck()` —— 已完成但后面还有已完成节点的，不允许取消，
  否则链条中间会断。判定只看**该节点在自己轨道内的位置**，与另一条轨无关。
- **节点改名会丢基准绑定**：风险基准是按 `label`（节点名）匹配的，改名后该节点变回「无期限」。
  前后端都是这个约定，界面上也有提示（`rc-note`）。
- **`RISK_CONFIGURABLE` / `RISK_FREE`**：只有「出想法/写论文/改论文/已投稿」4 个节点 × 2 条轨
  = 8 个字段开放设置，其余 4 个固定不设期限、不参与风险判定。这两个常量必须与后端
  `DEFAULT_RISK_CONFIG` 里非 `None` 的节点保持一致。
- **倒计时统一用一个时钟**：`CountUp` 以**首帧 rAF 的时间戳**为基准，不要混用 `performance.now()`
  （见「八、已知坑」第 8 条）。

---

## 六、样式分层（重要）

`styles.css` 里有**两套并存**的样式，靠前缀隔离，不要混用：

| 层 | 选择器前缀 | 用途 |
|----|-----------|------|
| 新版「晴日微风 · 暖阳纸艺」 | `.pg-shell`（外壳）+ 每页 `.pg-progress` `.pg-thesis` `.pg-report` `.pg-board` `.pg-msg` | Layout、进度看板、论文管理、周报、公告板、消息中心 |
| 旧版手账风 | 无前缀（`.panel` `.btn-primary` `.page-header` `.field` 等） | Login（现已换成 Gargantua）、问答点评、常用链接、账号管理 |

- 新版设计令牌（`--sun` `--rose` `--sage` `--card` `--line` `--spring` 等）定义在 `.pg-shell` 上，
  **只在 shell 内生效**，不会污染旧页面。
- ⚠️ `.pg-shell` 必须用 `overflow-x: clip` 而不是 `hidden`——`hidden` 会让 shell 变成滚动容器，
  里面所有 `position: sticky` 直接失效。
- 新版动画统一前缀 `pg-`（`pg-rise` `pg-pulseStamp` `pg-tapeFlutter` …）。
- **字体只用本地字体栈**（`PingFang SC` / `Songti SC` / `Kaiti SC`），
  **不得引入境外字体 CDN**（Google Fonts 首屏会卡数秒，曾因此被打回）。
- 登录页走 CSS Modules（见上），是唯一的例外。

### 手机上不做响应式（`index.html`）

`<meta name="viewport" content="width=1280" />` —— **刻意**把布局视口锁成 1280px，
让手机按桌面布局渲染、用户双指缩放浏览。

原因：媒体查询比的是**视口宽度**。把布局视口锁死后，`styles.css` 里那一堆
`@media (max-width: …)` 断点在手机上全部不会命中，于是原样渲染桌面版。
只给 `body`/`#root` 加 `min-width` 是治标——元素被撑开了，但媒体查询照旧命中，
布局会在窄屏下继续按窄屏堆叠。

**刻意不加 `user-scalable=no`**，保留双指缩放。

---

## 七、数据模型与 API

### 表（`backend/app/models.py`）

- **User**：username(唯一)、password_hash、name、role(`student`|`teacher`)、student_no、grade_id
- **Grade**：name(唯一，如 `2024级`)
- **ThesisProject**：student_id、title、stage、progress(0-100)、**milestones_json**、
  **risk_override**（老师手动指定的风险，为空则回落自动判定）
- **ThesisRound**：project_id、round_no、student_text、student_file(+orig)、submitted_at、
  teacher_comment、teacher_file(+orig)、feedback_at
- **WeeklyReport**：student_id、week(`2026-W37` ISO 周)、content_md
- **ReportComment**：report_id、author_id、content
- **Message**：from_id、to_id、topic(`论文管理`|`周报`|`问答点评`)、content、read_at
- **Setting**：key(主键)、value(JSON 字符串)。目前只用来存风险基准配置
- **Question / Reply / Announcement / Link**

### 里程碑：8 节点 × 2 轨道（v1.1 起）

| 概念 | 位置 | 说明 |
|------|------|------|
| `MILESTONE_LABELS` | `models.py` | 8 个节点名：学基础 / 看论文 / 出想法 / 写论文 / 改论文 / 已投稿 / 修论文 / 中论文 |
| `PAPER_TRACKS` | `models.py` | `(1, 2)`，两条论文轨道 |
| `DEFAULT_MILESTONES` | `models.py` | 8 × 2 = **16 项**，每项 `{key, label, track, plan, actual}` |
| `LEGACY_LABEL_MAP` | `models.py` | 旧版 6 节点标签 → 新版标签的 1:1 映射 |

**库里仍然是扁平数组**（形状和 v1.0 一样），只是每项多了一个 `track` 字段，总数从 6 变成 16。
前端按 `track` 分组渲染成两条时间轴。

旧版数据（6 节点、单论文）在**每次后端启动时自动升级**：

- 判定依据：新版每项都带 `track`，旧版没有。
- 旧的 `plan`/`actual` 按 `LEGACY_LABEL_MAP` 搬到「论文 1」轨道；
  新节点里的「学基础 / 看论文」在旧版没有对应，留空。
- **幂等**——已经是新结构的直接跳过，所以每次启动都能放心调。

```
开题 → 出想法    初稿 → 写论文    中期 → 改论文
查重 → 修论文    送审 → 已投稿    答辩 → 中论文
```

> 这份映射的实现在 `models.upgrade_legacy_milestones()`，
> **启动时的数据迁移和演示数据写入共用同一份**，别写第二份。

### 风险判定（`routers/thesis.py`，v1.1 起是四级制）

四个等级，从好到坏（`models.RISK_LEVELS`，**顺序即严重程度**）：

| 等级 | 触发条件（`_node_risk`） |
|------|------------------------|
| **遥遥领先** | 已完成，且实际日期**早于**基准日期 |
| **进度正常** | 未完成但**还没到期**；或逾期不足 3 个月 |
| **预警关注** | 逾期 3～4 个整月 |
| **严重滞后** | 逾期 ≥ 5 个整月 |

⚠️ **「遥遥领先」只在「已完成且早于基准」时给**。未完成但还没到期的只是「还没到期」，
算`进度正常`——否则刚入学的新生会全班显示遥遥领先。

**特殊提升规则**（`_is_leading`）：论文 1 的「已投稿」完成 **且** 论文 2 的「写论文」完成
→ 直接判「遥遥领先」。这是「两篇都推进到关键节点就算领先」的经验判定，
命中时无视上面的常规计算。同样是**按节点名匹配**，节点改名后就匹配不到了。

**汇总**（`compute_risk`）：遍历该学生的全部节点，取**最严重**的一级；
一个节点都没设期限就返回`进度正常`。

**基准日期怎么算**（`milestone_due`）：

```
基准日期 = 入学年·anchor_month（默认 9 月）的 1 号 + 该节点在该轨道上的偏移月数
```

- **按论文分轨**——`paper1` 与 `paper2` 的偏移不同，第二篇整体晚于第一篇。
  所以取基准**必须带上 `track`**，否则会取错。
- 偏移月数为 `null` 表示**该节点不设期限、不参与风险判定**。
- **入学年份**（`_enroll_year`）：优先取学号前 4 位（`2024001` → 2024），
  回落到年级名里的四位数字（`2024级`）。拿不到就返回 `None`、不参与判定。

默认基准（`models.DEFAULT_RISK_CONFIG`，锚点 9 月；只有这 8 个字段有值）：

| 节点 | paper1 | paper2 |
|------|:------:|:------:|
| 出想法 | +12 | +20 |
| 写论文 | +14 | +22 |
| 改论文 | +16 | +23 |
| 已投稿 | +18 | +24 |

> 例：2026 级（2026-09 入学）→ paper1 出想法 = 2027-09，paper2 出想法 = 2028-05。

**基准可在界面上改**（进度看板右上角「⏱ 进度时间基准」，仅老师），
存在 `Setting` 表的 `risk_config` 键里，改完全班风险立刻重算。

`load_risk_config()` 会与默认值**做合并**（方便以后加新节点），并且**兼容上一版的扁平结构**
（`{"anchor_month":9,"offsets":{…}}`）——检测到没有 `baselines` 时把旧的 `offsets` 当作 `paper1` 收进来，
`paper2` 用默认值补，老师之前改过的数值不会丢。幂等。

`project_view` 返回 `risk`（覆盖优先）、`risk_auto`（自动值）、`risk_override` 三个字段；
每个节点还会多一个后端算好的 **`due`** 字段，前端直接拿来显示，不重复实现日期推算。

### 数据库迁移

`SQLModel.metadata.create_all()` **只建缺失的表，不会给已存在的表加列**。
模型新增字段时必须登记到 `database.py` 的 `ADDED_COLUMNS`：

```python
ADDED_COLUMNS = {
    "thesisproject": [("risk_override", "VARCHAR")],
}
```

`init_db()` 启动时依次做三件事，**老库不用删**：

1. `create_all()` —— 建缺失的表（新增 `Setting` 这类表就不用写迁移）
2. `_ensure_columns()` —— 用 `PRAGMA table_info` 检测缺列并 `ALTER TABLE` 补上
3. `_migrate_milestones()` —— 把旧版 6 节点里程碑升级成 8 节点 × 2 轨道（幂等，会打印 `[migrate]` 日志）

### API 一览（前缀 `/api`，除 login 外都要 `Authorization: Bearer <token>`）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/login` | 公开 | `{username,password}` → `{token,user}`；密码错返回 **401** |
| GET | `/me` | 登录 | 当前用户 |
| POST | `/me/password` | 登录 | 修改自己的密码（验原密码，新密码 ≥6 位） |
| GET/POST/PUT/DELETE | `/grades[/{id}]` | GET 登录；写 老师 | 年级 CRUD |
| GET/POST/PUT/DELETE | `/users[/{id}]` | GET 登录；写 老师 | 账号 CRUD；`GET /users?role=student` 可筛选 |
| GET | `/thesis/risk-config` | 登录 | 风险基准配置（已与默认值合并） |
| PUT | `/thesis/risk-config` | 老师 | 改基准，改完全班风险立刻重算 |
| GET | `/thesis/projects` | 登录 | **师生都返回全班**（看板需要）；学生端在 `Thesis.jsx` 里按 `student_id` 自行过滤 |
| POST | `/thesis/projects/{student_id}` | 老师 | 为学生建项目（初始 **8 节点 × 2 轨道 = 16 项**） |
| PUT | `/thesis/projects/{id}` | 老师改全部；学生只能改自己的 title | 可传 `title/stage/progress/milestones/risk_override` |
| GET/POST | `/thesis/projects/{id}/rounds` | 师生（限本人项目） | POST 为 multipart：`text`+`file`；前轮未批注返回 400 |
| PUT | `/thesis/rounds/{rid}` | 学生本人 | 老师批注前可改：`text`+`file`+`keep_file=0` 删附件 |
| POST | `/thesis/rounds/{rid}/feedback` | 老师 | multipart：`comment`+`file` |
| GET | `/thesis/files/{stored_name}` | 登录 | 下载附件 |
| GET | `/reports/weeks` | 登录 | `{current, weeks[12]}`，由近及远 |
| GET | `/reports/my` | 登录 | 我的周报列表（学生用） |
| POST | `/reports/my/{week}` | 学生 | upsert 某周周报 |
| GET | `/reports/board?week=` | 老师 | 某周全班 已交/未交/逾期（周日截止） |
| GET | `/reports/student/{sid}` | 老师 | 某学生全部周报 |
| POST | `/reports/{rid}/comments` | 师生（限本人） | 点评 |
| GET | `/messages` | 登录 | 老师看自己发出的、学生看收到的；含 `unread` |
| POST | `/messages` | 老师 | `{to_id,topic,content}` |
| POST | `/messages/read` | 登录 | 把我收到的全部标为已读 |
| GET/POST/DELETE | `/questions[/{id}]`，POST `/questions/{id}/replies` | 登录 | 问答；删除限本人或老师 |
| GET/POST/DELETE | `/announcements[/{id}]` | GET 登录；写 老师 | 公告 |
| GET/POST/DELETE | `/links[/{id}]` | GET 登录；写 老师 | 链接 |

交互式文档：http://localhost:5183/docs （设了 `GM_DISABLE_DOCS=1` 就没有这一页）

---

## 八、已知坑（踩过，勿复踩）

1. **Banner 标题走 `usePageBanner`**，不是 `<GlobalBanner>` 的 props（见五·2）。
2. **`.ride` 必须保持 `pointer-events: none`**：它 `z-index` 高于导航，一旦能接收事件就会挡点击。
3. **`.pg-shell` 用 `overflow-x: clip`**，用 `hidden` 会让内部的 sticky 全部失效。
4. **`api.js` 的 401 要分两种**（见五·4），否则密码错误会变成整页重载 + 错误文案。
5. **`useMemo` 是立即求值**：引用后面声明的 `const` 会直接 TDZ 报错、整页白屏。
   把依赖的变量移到前面，或改用函数。
6. **React 18 不认 `inert` prop**，要 `setAttribute`/`removeAttribute` 命令式同步。
7. **受控表单自动化**：测试脚本直接设 `input.value` 无效，要用原生 value setter + dispatch `input` 事件。
8. **headless 下 CSS 过渡不推进**：`--virtual-time-budget` 里 transition 停在起始态，
   截图要用 `* { transition: none }` 才能看到终态。
   而 `performance.now()` 与 rAF 时间戳基准可能不一致，**混用会让倒计时出现负数**——
   统一用一个时钟（见 `Progress.jsx` 的 `CountUp`，它以首帧 rAF 时间戳为基准）。
9. **登录页引擎的 `dispose()` 必须调用**：那 8 个监听挂在 `window`/`document` 上，不移除会泄漏。
10. **单端口托管**：改完前端要在 5183 生效必须 `npm run build`；只跑 `dev` 时 5183 仍是旧版本。
11. **两个标签页同登不同账号会互相顶掉**：token 必须留在 sessionStorage，别改回 localStorage。
12. **403 排查**：几乎都是「当前标签页其实登的是学生账号」，看后端日志里 403 的路径即可确认。
13. **风险基准是按节点名（`label`）匹配的**：节点一改名就失去基准绑定、变回「无期限」，
    前后端都是这个约定。改 `MILESTONE_LABELS` 或让老师改节点名之前先想清楚这一点。
14. **加模型字段必须登记 `ADDED_COLUMNS`**：`create_all()` 只建表不加列，漏登记老库一查就报
    `no such column`（新增整张表则不用，`create_all` 会建）。
15. **别手改 `seed_snapshot.py`**：它由 `export_seed_snapshot.py` 生成，下次导出会覆盖；
    要改演示数据请改库再重新导出。
16. **手机上不要试图做响应式**：视口被刻意锁成 1280px（见六），加媒体查询断点不会按预期生效。

---

## 九、常见任务怎么做

**加一个新页面**

1. `pages/Xxx.jsx`，写一个 `XxxBannerBridge()` 组件调用 `usePageBanner({title, subtitle})` 并在页面里渲染；
2. 页面根元素用新的 `.pg-xxx` 前缀类，样式写进 `styles.css` 并全部加该前缀；
3. `App.jsx` 加 `<Route path="xxx" element={<Xxx />} />`；需要老师专属就包 `<TeacherOnly>`；
4. `GlobalBanner.jsx` 的 `NAV` 数组加一项（老师专属加 `teacherOnly: true`）；
5. 图表一律**手写 SVG**，不要引图表库。

**加一个后端接口**

1. 在对应 `routers/*.py` 里加路由；老师专属用 `Depends(require_teacher)`，普通登录用 `Depends(get_current_user)`；
2. 涉及越权的（比如按 id 取他人数据）**必须在后端判断归属并 403**，不要只靠前端隐藏；
3. 模型加字段 → 同步登记 `database.py` 的 `ADDED_COLUMNS`；
4. `GET /docs` 自测。

**改里程碑节点 / 风险规则**

1. 节点名和轨道定义在 `models.MILESTONE_LABELS` / `DEFAULT_MILESTONES`，改这里要同步
   `LEGACY_LABEL_MAP`（旧数据的映射）和前端 `Progress.jsx` 的
   `RISK_CONFIGURABLE` / `RISK_FREE`；
2. 基准默认值在 `models.DEFAULT_RISK_CONFIG`；
3. 判定规则在 `routers/thesis.py` 的 `_node_risk` / `_is_leading` / `compute_risk`；
4. **注意别让已入库的数据格式失效**——形状不变、只加字段的话，走 `ADDED_COLUMNS` 或
   `upgrade_legacy_milestones()` 那样写个幂等迁移。

**改演示数据**

先把库调成想要的样子，再 `scripts/export_seed_snapshot.py` 重新导出（见三）。

**改弹窗**

所有创建/编辑都用弹窗，**每个弹窗都要支持 ESC 与点击蒙层关闭**。
新版页面用各自的手账风弹窗（`.pg-* .modal` / `.pop` / `.overlay` / 手账本 `.book`），
旧页面用 `components.jsx` 的 `Modal`。

**提示反馈**

一律用 `useToast()`（右上角滑入，默认 3.2 秒后自动消失，点击立即关闭），**不要内联错误文案**。
成功 `'success'`、失败 `'error'`、默认 `'info'`。

---

## 十、未做的事 / 可继续的方向

- 消息推送目前是 **10 秒轮询**（`messages.jsx`），真上线应换成 SSE / WebSocket。
- `temp/`（原型 HTML）已在 `.gitignore` 里，README 里对它的引用**在新克隆的仓库里会失效**；
  若希望原型一起入库，删掉 `.gitignore` 里 `temp/` 那两行。
- `charts.jsx` / `components.jsx` 是旧版遗留，新版页面已不用，可择机清理。
- `demo_data.py` 与 `seed_snapshot.py` 两份演示数据源**并存**：
  前者管名单和逐条测试数据（脚本用），后者管空库初始状态。
  目前 `seed.py` 已经不走 `demo_data.DEMO` 了，`demo_data.py` 的模块 docstring
  还写着旧说法，**待更正**。
- 风险判定的「遥遥领先」提升规则（`_is_leading`）是硬编码的节点名组合，
  换成可配置的规则表会更灵活。
- 公网部署与版本更新流程未随仓库分发（见三）。
