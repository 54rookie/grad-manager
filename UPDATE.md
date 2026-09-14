# 更新已部署的线上服务

> 面向执行者（人或 AI）。**首次部署**请看 [`DEPLOY.md`](./DEPLOY.md)，本文只讲「服务已经在阿里云跑起来了，现在要把代码换成新版本」。
>
> 所有命令都可直接复制执行；`<>` 里的内容替换成实际值。
> **第 0 节是安全底线，第 9 节是给 AI 的一步步清单**——赶时间就直接看这两节。

---

## 0. 安全底线：这三样东西**永远不要覆盖**

线上目录长这样（与 `DEPLOY.md` 一致）：

```
/var/www/grad-manager/          ← 代码，可以随便覆盖
├── backend/
│   ├── app/                    ← ✅ 覆盖
│   ├── scripts/                ← ✅ 覆盖
│   ├── requirements.txt        ← ✅ 覆盖
│   └── .venv/                  ← ❌ 绝对不要动
└── frontend/
    └── dist/                   ← ✅ 覆盖（Vite 产物，本地构建）

/var/lib/grad-manager/          ← ❌ 数据，永远不动
├── grad_manager.db             ←    全部业务数据
├── grad_manager.key            ←    JWT 签名密钥
└── uploads/                    ←    全部附件

/etc/grad-manager.env           ← ❌ 密钥与初始密码，永远不动
```

| 不能动的东西 | 动了会怎样 |
|---|---|
| `backend/.venv/` | 本地那份是 **macOS ARM64** 二进制，服务器是 Linux x86_64。覆盖后服务**直接启动不了**，报一堆查不到符号的老错 |
| `/var/lib/grad-manager/` | 数据库被旧数据覆盖 → 期间所有人提交的周报、往返、附件全没 |
| `/etc/grad-manager.env` | 密钥/密码被覆盖 → 可能换掉 JWT 密钥，**所有人被登出** |

> 所以更新时**只解包 `backend/app`、`backend/scripts`、`backend/requirements.txt`、`frontend/dist`**，
> 不要图省事把整个 `backend/` 目录删掉重解——那会把 `.venv` 一起删了。

---

## 1. 先判断：这次改了什么？

这决定要不要重启、要不要装依赖。**先看这张表再动手**：

| 这次改动的范围 | 要不要 rebuild 前端 | 要不要重启后端 | 要不要 pip install |
|---|:---:|:---:|:---:|
| 只改前端（`frontend/src/**`、`index.html`、`styles.css`） | **要** | **不用** | 不用 |
| 只改后端（`backend/app/**`） | 不用 | **要** | 不用 |
| 后端依赖变了（`requirements.txt`） | 不用 | **要** | **要** |
| 后端数据模型变了（`models.py` 加字段 / 改里程碑结构） | 不用 | **要** | 不用 |
| 前后端都改了 | **要** | **要** | 视 `requirements.txt` 而定 |

三条容易搞错的：

- **前端改动不需要重启后端**。Nginx 直接读 `frontend/dist` 的文件，覆盖即生效。
- **数据模型改了也不用手工迁移**。后端启动时自己会做两件事：
  1. `ADDED_COLUMNS` 里登记过的新列，用 `PRAGMA table_info` 检测缺列并 `ALTER TABLE` 补上；
  2. 旧版里程碑结构自动升级成新版（幂等）。
  所以「改模型 → 重启」就够了，**不需要删库、也不需要跑迁移脚本**。
- **改 `GM_SECRET_KEY`（或删 `grad_manager.key`）会让所有已登录用户立刻掉线**。不影响数据，重新登录即可。

---

## 2. 本地：确认代码 + 构建前端

在**开发机**的项目根目录：

```bash
cd <项目路径>/grad-manager

# ① 拿到最新代码
git fetch origin && git merge --ff-only origin/main      # 或 git pull
git log --oneline -3                                     # 确认拿到的是预期的提交

# ② 只在前端有改动时才需要 build（见第 1 节那张表）
cd frontend && npm run build && cd ..
ls -l frontend/dist/assets/                              # 确认产物是刚刚生成的（时间戳新）
```

---

## 3. 本地：打包

```bash
cd <项目路径>/grad-manager
rm -f /tmp/grad-manager-update.tar.gz
tar czf /tmp/grad-manager-update.tar.gz \
  --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='grad_manager.db' --exclude='grad_manager.key' \
  --exclude='uploads' --exclude='node_modules' --exclude='.git' \
  --exclude='.DS_Store' \
  -C . backend/app backend/scripts backend/requirements.txt frontend/dist \
       README.md DEPLOY.md UPDATE.md

# 核对包内容：绝不能出现 .venv / *.db / uploads
tar tzf /tmp/grad-manager-update.tar.gz | grep -E '\.venv|\.db$|uploads/|node_modules' \
  && echo "❌ 包里有不该有的东西，停下来检查" \
  || echo "✅ 包内容干净"
```

---

## 4. 上传并覆盖

```bash
scp /tmp/grad-manager-update.tar.gz root@<SERVER_IP>:/tmp/
```

然后**在服务器上**执行（先备份，再覆盖）：

```bash
# ① 更新前备份数据库（万一要回滚，数据也能对上）
mkdir -p /var/backups/grad-manager
sqlite3 /var/lib/grad-manager/grad_manager.db \
  ".backup /var/backups/grad-manager/before-update-$(date +%F-%H%M).sqlite3"
ls -lh /var/backups/grad-manager/ | tail -3
```

```bash
# ② 前端：整个删掉再解包（Vite 产物带 hash，新旧文件会堆积）
rm -rf /var/www/grad-manager/frontend/dist
mkdir -p /var/www/grad-manager/frontend

# ③ 解包覆盖（-C 指向 /var/www/grad-manager，包内路径是 backend/... frontend/...）
tar xzf /tmp/grad-manager-update.tar.gz -C /var/www/grad-manager

# ④ 纠正权限（解包后属主会变成 root）
chown -R www-data:www-data /var/www/grad-manager
```

> ⚠️ 第 ② 步只删 `frontend/dist`，**不要**顺手 `rm -rf /var/www/grad-manager/backend`——
> 那会把 `.venv` 一起删掉，服务就起不来了。

**如果这次有文件被删除或改名**（tar 覆盖不会删旧文件），用这条找出来并手工清掉：

```bash
# 列出线上有、但新包里没有的后端文件（比较后再决定删不删）
comm -23 \
  <(cd /var/www/grad-manager && find backend -name '*.py' | sort) \
  <(tar tzf /tmp/grad-manager-update.tar.gz | grep '\.py$' | sed 's|^\./||' | sort)
```

---

## 5. 按需安装依赖

**只有 `requirements.txt` 变了才需要**（第 1 节那张表）：

```bash
cd /var/www/grad-manager/backend
./.venv/bin/pip install -r requirements.txt
# 注意：用 ./.venv/bin/pip，不要用系统 pip，也不要重建 venv
```

---

## 6. 重启（如果需要）

```bash
systemctl restart grad-manager
sleep 5
systemctl status grad-manager --no-pager        # 应为 active (running)
```

> 只改前端的话**跳过这一步**。Nginx 读的是静态文件，覆盖即生效。

看启动日志有没有报错（迁移信息也会打在这里）：

```bash
journalctl -u grad-manager -n 30 --no-pager
```

正常的话能看到：

```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:5183
```

如果这次动了数据模型，还会多一行：

```
[migrate] 已把 N 份旧里程碑升级为 8 节点 × 2 论文轨道（映射表见 models.LEGACY_LABEL_MAP）
```

---

## 7. 验收

```bash
# ① 后端活着（用 GET，不要用 curl -I：HEAD 会被 SPA 路由拒成 405）
curl -s -o /dev/null -w '后端 → %{http_code}\n' http://127.0.0.1:5183/

# ② 公网可访问
curl -s -o /dev/null -w 'HTTPS → %{http_code}\n' https://<DOMAIN>

# ③ 真实登录接口通
curl -s -X POST https://<DOMAIN>/api/login -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"<TEACHER_PASSWORD>"}' | head -c 60

# ④ 数据还在（这几个数应与更新前一致，除非本次就是特意改的）
sqlite3 /var/lib/grad-manager/grad_manager.db \
  "SELECT (SELECT count(*) FROM user)||' 用户 / '||(SELECT count(*) FROM thesisproject)||' 项目 / '||(SELECT count(*) FROM weeklyreport)||' 周报 / '||(SELECT count(*) FROM thesisround)||' 往返';"
```

**必须在浏览器里手工验一项**：打开 `https://<DOMAIN>` → 登录 → 进**本次改动涉及的那个页面**走一遍。
如果是附件相关改动，务必真传一个 PDF 试试（Nginx 的 `client_max_body_size` 是常见坑）。

---

## 8. 回滚

代码回滚（数据不动）：

```bash
# 方式一：用上一个版本的包重新解包（保留旧包是好习惯）
tar xzf /tmp/grad-manager-update-上一个版本.tar.gz -C /var/www/grad-manager
chown -R www-data:www-data /var/www/grad-manager
systemctl restart grad-manager
```

数据回滚（**仅在这次更新改坏了数据时才做**，会丢掉之后的所有提交）：

```bash
systemctl stop grad-manager
cp /var/backups/grad-manager/before-update-<时间戳>.sqlite3 /var/lib/grad-manager/grad_manager.db
chown www-data:www-data /var/lib/grad-manager/grad_manager.db
systemctl start grad-manager
```

---

## 9. 给 AI 的执行清单

> 照着做即可。**遇到「停下来问人」的分支就先停下**，不要自行决定。

1. **确认工作目录**：项目根目录下有 `backend/`、`frontend/`、`DEPLOY.md`。不是的话先找对路径。
2. **判断改动范围**：`git diff --name-only HEAD~1` 或看用户给的改动说明，对照第 1 节的表，记下三个「要不要」。
3. **本地构建**（仅当改到了 `frontend/`）：`cd frontend && npm run build`，确认退出码为 0 且 `dist/assets/` 有新文件。
4. **打包**：执行第 3 节的 `tar` 命令，然后跑那条 `grep -E '\.venv|\.db$|uploads'` 自检——**输出非空就停下问人**。
5. **上传**：`scp` 到 `/tmp/`。
6. **服务器上先备份数据库**（第 4 节 ①）。这一步**不许跳过**——它是唯一的回滚依据。
7. **覆盖**：删 `frontend/dist` → 解包 → `chown`。**不要删 `backend/` 整个目录**。
8. **按需装依赖**（仅当 `requirements.txt` 变了）：用 `./.venv/bin/pip`。
9. **按需重启**（仅当改到 `backend/`）：`systemctl restart grad-manager`，然后 `journalctl` 看有没有 Traceback。
10. **验收**：跑第 7 节的四条 curl，再**让用户在浏览器里亲自过一遍**受影响的功能。
11. **报告**：把「改了哪些文件 / 有没有重启 / 依赖装没装 / 验收结果」如实说明。
    **不要**在没跑验收的情况下说「更新完成」。

**红线**（任何一条都不能碰）：

- 不删、不重建 `backend/.venv`
- 不覆盖 `/var/lib/grad-manager/`
- 不覆盖 `/etc/grad-manager.env`
- 不在没备份数据库的情况下动数据
- 不执行 `rm -rf /var/www/grad-manager/backend`

---

## 10. 故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| 服务起不来，日志报无法加载模块 / 符号错误 | 误把本地 `.venv` 传上去了 | `rm -rf backend/.venv`，在服务器上重建：`python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt` |
| 服务 502 / 起不来，日志有 Traceback | 后端代码或依赖问题 | 看 `journalctl -u grad-manager -n 50 --no-pager` 完整栈 |
| 页面打开是旧版本 | 前端没 build，或 `dist` 没覆盖、浏览器/CDN 缓存 | 重跑第 2 节的 build + 第 4 节的覆盖；浏览器强制刷新（Cmd/Ctrl+Shift+R） |
| 页面 404 / 白屏 | `frontend/dist/index.html` 不存在或权限不对 | `ls -l /var/www/grad-manager/frontend/dist/`，确认 `index.html` + `assets/` 都在且属主是 www-data |
| 接口 404 | Nginx 的 `/api/` 代理丢了 | `nginx -t && systemctl reload nginx`，检查 `/etc/nginx/conf.d/<DOMAIN>.conf` |
| 附件上传失败 / 413 | `client_max_body_size` 被改回默认 | 该行必须在**这个域名自己的 server 块**里 |
| 所有人被登出 | JWT 密钥变了 | 说明 `grad_manager.key` 或 `GM_SECRET_KEY` 被改动过，重新登录即可；查第 0 节的「不能动」清单 |
| 数据变少 / 回到旧状态 | 数据库被旧文件覆盖了 | 用第 8 节的备份回滚，并检查是不是把 `/var/lib/grad-manager` 一起打包上传了 |

**一条命令区分「服务器问题」还是「CDN/网关问题」**：

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: <DOMAIN>' http://127.0.0.1/
```

返回 `200` = 服务器侧完全正常，问题在 Cloudflare / 安全组；返回 `502` = 后端没起来。
