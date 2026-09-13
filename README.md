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
| 进度看板 | `/progress` | 师生（**学生只读**） | 按年级分组展示全班论文进度：阶段、完成度（手写 SVG 甜甜圈）、关键节点计划/实际时间（SVG 时间轴）、自动风险判定。老师可编辑时间轴、手动改风险、看往返与周报并「一键催办」；学生进去是全面降级只读 |
| 论文管理 | `/thesis` | 师生 | 多轮往返：学生提交文字+附件 → 老师批注并回传批注文件 → 学生再提交。全部留档。**上一轮未获批注时禁止开新一轮**，但可以「修改本次提交」。老师的默认首页 |
| 每周周报 | `/reports` | 师生 | 学生每周交 Markdown 周报（可编辑/预览/历史只读）；老师按周看全班 已交/未交/逾期 并点评 |
| 问答点评 | `/qa` | 师生 | 类小红书信息流：任何人发帖、全员可见、任何人可回复 |
| 每日公告 | `/announcements` | 师生（发布仅老师） | 软木墙 + 便签，老师发布/删除 |
| 常用链接 | `/links` | 师生（维护仅老师） | 老师维护的外链按钮，新窗口打开 |
| 消息中心 | `/messages` | 师生 | 老师催办发给学生的定向消息；学生看收件箱，Banner 铃铛有未读角标 |
| 账号管理 | `/accounts` | **仅老师** | 增删改、重置密码；学生访问会被重定向到 `/thesis`。**不在主导航**，入口是 Banner 右上角的太阳 ☀ |

登录后按角色分流：老师 → `/progress`，学生 → `/thesis`（见 `App.jsx` 的 `Home` 与 `TeacherOnly`）。

---

## 二、技术栈与端口

| 层 | 技术 | 端口 |
|----|------|------|
| 前端 | React 18 + Vite 5 + React Router v6；**绝大多数样式是原生 CSS**（`styles.css`），仅登录页用 CSS Modules | 5173（仅开发） |
| 后端 | FastAPI + SQLModel + SQLite（单文件库 `backend/grad_manager.db`） | **5183** |
| 认证 | JWT Bearer（python-jose）；密码用 **bcrypt 直接哈希**（⚠️ 不要用 passlib，与 bcrypt 4.x 不兼容） | — |

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

首次启动自动建表并写入种子数据（`backend/app/seed.py`，仅当库为空时写入）。

**重置数据**：停掉后端，删 `backend/grad_manager.db` 与 `backend/uploads/`，重启即可。

### 演示账号（密码统一 `123456`）

- 老师：`teacher`（王老师，导师）
- 2024 级：`liuwenqiang` 刘文强、`liuzilong` 刘子龙、`yanglei` 杨磊
- 2025 级：`liufuqiang` 刘富强、`panyouqi` 潘有琪、`tongjian` 童健、`zhangchenghe` 张成赫
- 2026 级：`yangkang` 杨康、`xiexundong` 谢循东、`fengcheng` 冯成

> ⚠️ 当前开发库里 **`liuwenqiang` 的密码不是 `123456`**（被改过，登录会返回「用户名或密码错误」）。
> 其余账号正常。用 `teacher` + `panyouqi` 演示最稳。

**灌测试数据**：`cd backend && ./.venv/bin/python scripts/seed_student_demo.py`（可重复执行，先清后写）。

**重置学生名单**：改 `backend/app/demo_data.py` 里的 `STUDENTS`，然后
`cd backend && ./.venv/bin/python scripts/reset_students.py`
——它会删除全部旧学生**及其论文项目、往返记录、周报、问答数据**与孤立附件，再按名单重建账号和空白论文项目。

> 学生名单与演示数据都集中在 **`backend/app/demo_data.py`**（单一来源，
> `seed.py` / `reset_students.py` / `seed_student_demo.py` 三个入口都从这里取）：
> 改名单改那里的 `STUDENTS`，加测试数据往 `DEMO` 里塞，别去 `seed.py` 或脚本里改。
> 目前给 `liuwenqiang`、`liuzilong` 各准备了 1 个论文项目（含节点计划/实际时间，
> 两人风险分别是「正常」与「滞后」）、2 轮往返（第 1 轮已批注+附件、第 2 轮**待批注**）、
> 若干周报（含老师点评，刘子龙缺 W36 可测「未交/逾期」）与 1 条提问。其他人保持干净。

---

## 四、目录结构

```
backend/
  app/
    main.py        # FastAPI 入口：CORS、/api/login、/api/me、/api/me/password、挂载路由、启动建库+种子、SPA 回退
    database.py    # engine、get_session、UPLOAD_DIR、ADDED_COLUMNS（缺列自动补）
    models.py      # 全部 SQLModel 表 + STAGES / DEFAULT_MILESTONES
    auth.py        # bcrypt 哈希、JWT 签发/校验、get_current_user、require_teacher
    demo_data.py   # ⭐ 演示数据的「单一来源」：GRADES / STUDENTS 名单、
                   #    DEMO（刘文强·刘子龙的完整测试数据）、clear_student、apply_student_demo
    seed.py        # 首次启动写入演示数据（数据本身取自 demo_data.py）
    routers/
      grades.py    # /api/grades、/api/users
      thesis.py    # /api/thesis/* 项目、多轮往返、附件
      reports.py   # /api/reports/* 周报与点评
      misc.py      # /api/questions、/api/announcements、/api/links
      messages.py  # /api/messages 定向消息
  scripts/         # reset_students.py / seed_student_demo.py
  uploads/         # 上传附件（uuid 命名，原始文件名存库），不入库

frontend/src/
  main.jsx          # BrowserRouter > ToastProvider > AuthProvider > MessagesProvider > App
  App.jsx           # 全部路由 + 角色守卫（Guard / TeacherOnly / Home）
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
`<TeacherOnly>` 包住仅老师可进的页面（目前只有 `/accounts`），学生访问会被送回 `/thesis`。
`<Home>` 按角色分流到 `/progress` 或 `/thesis`。

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

---

## 七、数据模型与 API

### 表（`backend/app/models.py`）

- **User**：username(唯一)、password_hash、name、role(`student`|`teacher`)、student_no、grade_id
- **Grade**：name(唯一，如 `2024级`)
- **ThesisProject**：student_id、title、stage、progress(0-100)、milestones_json、
  **risk_override**（老师手动指定的风险，为空则回落自动判定）
- **ThesisRound**：project_id、round_no、student_text、student_file(+orig)、submitted_at、
  teacher_comment、teacher_file(+orig)、feedback_at
- **WeeklyReport**：student_id、week(`2026-W37` ISO 周)、content_md
- **ReportComment**：report_id、author_id、content
- **Message**：from_id、to_id、topic(`论文管理`|`周报`|`问答点评`)、content、read_at
- **Question / Reply / Announcement / Link**

**风险判定**（`routers/thesis.py::compute_risk`）：某节点计划日期已过且无实际日期 →
超 14 天为「滞后」，否则「预警」；全正常为「正常」。
`project_view` 返回 `risk`（覆盖优先）、`risk_auto`（自动值）、`risk_override` 三个字段。

### 数据库迁移

`SQLModel.metadata.create_all()` **只建缺失的表，不会给已存在的表加列**。
模型新增字段时必须登记到 `database.py` 的 `ADDED_COLUMNS`：

```python
ADDED_COLUMNS = {
    "thesisproject": [("risk_override", "VARCHAR")],
}
```

`init_db()` 启动时用 `PRAGMA table_info` 检测缺列并 `ALTER TABLE` 补上，**老库不用删**。

### API 一览（前缀 `/api`，除 login 外都要 `Authorization: Bearer <token>`）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/login` | 公开 | `{username,password}` → `{token,user}`；密码错返回 **401** |
| GET | `/me` | 登录 | 当前用户 |
| POST | `/me/password` | 登录 | 修改自己的密码 |
| GET/POST/PUT/DELETE | `/grades[/{id}]` | GET 登录；写 老师 | 年级 CRUD |
| GET/POST/PUT/DELETE | `/users[/{id}]` | GET 登录；写 老师 | 账号 CRUD；`GET /users?role=student` 可筛选 |
| GET | `/thesis/projects` | 登录 | **师生都返回全班**（看板需要）；学生端在 `Thesis.jsx` 里按 `student_id` 自行过滤 |
| POST | `/thesis/projects/{student_id}` | 老师 | 为学生建项目（初始六节点） |
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

交互式文档：http://localhost:5183/docs

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
   统一用一个时钟（见 `Progress.jsx` 的 `CountUp`）。
9. **登录页引擎的 `dispose()` 必须调用**：那 8 个监听挂在 `window`/`document` 上，不移除会泄漏。
10. **单端口托管**：改完前端要在 5183 生效必须 `npm run build`；只跑 `dev` 时 5183 仍是旧版本。
11. **两个标签页同登不同账号会互相顶掉**：token 必须留在 sessionStorage，别改回 localStorage。
12. **403 排查**：几乎都是「当前标签页其实登的是学生账号」，看后端日志里 403 的路径即可确认。

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

**改弹窗**

所有创建/编辑都用弹窗，**每个弹窗都要支持 ESC 与点击蒙层关闭**。
新版页面用各自的手账风弹窗（`.pg-* .modal` / `.pop` / `.overlay` / 手账本 `.book`），
旧页面用 `components.jsx` 的 `Modal`。

**提示反馈**

一律用 `useToast()`（右上角滑入、约 3 秒消失），**不要内联错误文案**。
成功 `'success'`、失败 `'error'`。

---

## 十、未做的事 / 可继续的方向

- 消息推送目前是 **10 秒轮询**（`messages.jsx`），真上线应换成 SSE / WebSocket。
- `temp/`（原型 HTML）已在 `.gitignore` 里，README 里对它的引用**在新克隆的仓库里会失效**；
  若希望原型一起入库，删掉 `.gitignore` 里 `temp/` 那两行。
- `charts.jsx` / `components.jsx` 是旧版遗留，新版页面已不用，可择机清理。
- `liuwenqiang` 的密码与文档不一致，需要时用账号管理页重置。
