# 部署到阿里云 ECS

> 面向执行者（人或 AI）：照着从第 1 节做到第 9 节即可完成部署。
> 所有命令都是可直接复制执行的；**尖括号 `<>` 里的内容需要替换成实际值**。
> 第 11 节是故障排查表，遇到报错先查那里。

---

## 0. 最终形态

```
用户浏览器 ──HTTPS──> Cloudflare ──HTTP:80──> Nginx ──┬── 静态文件  /var/www/grad-manager/frontend/dist
                                                      └── /api/*  proxy → 127.0.0.1:5183 (uvicorn)
```

| 组件 | 位置 | 说明 |
|------|------|------|
| 后端 | `/var/www/grad-manager/backend/` | FastAPI，systemd 托管，只监听 `127.0.0.1:5183` |
| 前端 | `/var/www/grad-manager/frontend/dist/` | 构建产物，由 Nginx 直接托管 |
| 数据 | `/var/lib/grad-manager/` | SQLite 库 + JWT 密钥 + 附件目录，**与代码分离** |
| Nginx | `/etc/nginx/conf.d/<DOMAIN>.conf` | 新建独立 server 块，不动服务器上已有的站点 |
| 进程守护 | systemd | **不要用 pm2**（那是 Node 的，这是 Python 应用，两套守护会打架） |

---

## 1. 前置条件与参数

开工前先跟用户确认下表，后面所有命令都依赖它：

| 参数 | 示例 | 说明 |
|------|------|------|
| `<DOMAIN>` | `grad.54rookie.com` | 要部署的域名 |
| `<SERVER_IP>` | `47.xx.xx.xx` | ECS 公网 IP |
| `<TEACHER_PASSWORD>` | 由用户指定 | `teacher` 账号的初始密码，**不要用 123456** |
| `<CERT_EMAIL>` | `a@b.com` | 仅 Nginx 自己签证书时需要 |

**必须确认的两件事**（决定方案走向）：

1. **ECS 地域与 ICP 备案**
   - 中国大陆地域 → 域名**必须已备案**，否则阿里云会阻断该域名 80/443 的访问
   - 香港 / 海外 → 免备案
   - ⚠️ 备案是法务流程，**停机重来也解决不了**，未备案就别往大陆机器上部署

2. **TLS 在哪终结**
   - **Cloudflare 等 CDN 终结**（本项目当前用法）→ 源站只开 80，Cloudflare 侧设 `Flexible`
   - **Nginx 自己签**→ 按第 7 节的可选部分加 443

---

## 2. 本地打包

在**开发机**的项目根目录执行（需要 Node 已 `npm install`）：

```bash
cd frontend && npm run build          # 产物进 frontend/dist
cd ..
tar czf /tmp/grad-manager-deploy.tar.gz \
  --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='grad_manager.db' --exclude='grad_manager.key' \
  --exclude='uploads' --exclude='node_modules' --exclude='.git' \
  --exclude='.DS_Store' \
  -C . backend frontend/dist README.md DEPLOY.md .gitignore
```

> ⚠️ **四个绝对不能打包的东西**，理由：
> - `backend/.venv/` —— 开发机是 macOS ARM64，服务器是 Linux x86_64，**二进制不兼容**，传上去必然报错。必须在服务器上重建。
> - `backend/grad_manager.db` —— 本地测试数据，带上生产等于把测试数据发布出去
> - `backend/grad_manager.key` —— JWT 密钥，服务器上会自动生成新的
> - `frontend/node_modules/` —— 几百 MB 且平台相关

传到服务器：

```bash
scp /tmp/grad-manager-deploy.tar.gz root@<SERVER_IP>:/var/www/
```

---

## 3. 服务器初始化

```bash
apt update && apt install -y nginx python3-venv python3-pip sqlite3

# 建数据目录（代码与数据分离，备份/权限都清爽）
mkdir -p /var/lib/grad-manager/uploads

# 解包
mkdir -p /var/www/grad-manager
tar xzf /var/www/grad-manager-deploy.tar.gz -C /var/www/grad-manager
ls /var/www/grad-manager          # 应看到 backend/ frontend/ README.md
```

**重建虚拟环境**（不能用开发机那份）：

```bash
cd /var/www/grad-manager/backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

> 需要 Python ≥ 3.10（代码用了 `str | None` 语法）。Ubuntu 22.04 是 3.10、24.04 是 3.12，都够。

```bash
chown -R www-data:www-data /var/www/grad-manager /var/lib/grad-manager
```

---

## 4. 环境变量

```bash
cat > /etc/grad-manager.env <<'EOF'
GM_DB_PATH=/var/lib/grad-manager/grad_manager.db
GM_UPLOAD_DIR=/var/lib/grad-manager/uploads
GM_DISABLE_DOCS=1
GM_SEED_PASSWORD=<TEACHER_PASSWORD>
EOF
chmod 600 /etc/grad-manager.env
```

| 变量 | 作用 |
|------|------|
| `GM_DB_PATH` / `GM_UPLOAD_DIR` | 把数据指到 `/var/lib`，与代码分离 |
| `GM_DISABLE_DOCS=1` | 关闭 `/docs`、`/redoc`、`/openapi.json`，公网不暴露接口结构 |
| `GM_SEED_PASSWORD` | **仅在首次建库（库为空）时生效**，决定 `teacher` 与全部学生的初始密码 |
| `GM_SECRET_KEY` | JWT 签名密钥。**不设也行**——会自动生成一份随机密钥存到数据库同目录的 `grad_manager.key`（权限 600）。多实例部署才需要显式设成同一个值 |

> ⚠️ `GM_SEED_PASSWORD` 必须在**第一次启动之前**设好。库建完之后再改这个变量不会有任何效果。

---

## 5. systemd 托管后端

```bash
cat > /etc/systemd/system/grad-manager.service <<'EOF'
[Unit]
Description=Grad Manager (FastAPI)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/grad-manager/backend
EnvironmentFile=/etc/grad-manager.env
ExecStart=/var/www/grad-manager/backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 5183
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now grad-manager
sleep 5
systemctl status grad-manager --no-pager        # 应为 active (running)
```

**本机自测**（⚠️ 用 GET，不要用 `curl -I`）：

```bash
curl -s -o /dev/null -w 'GET / → %{http_code}\n' http://127.0.0.1:5183/
ls -la /var/lib/grad-manager/                    # 应出现 grad_manager.db 与 grad_manager.key
```

> `curl -I` 发的是 **HEAD**，而 SPA 回退路由只注册了 GET，会返回 **405**。这是正常的，不是故障。

---

## 6. Nginx

**新建独立配置文件**——如果服务器上已有别的站点（例如 `conf.d/blog.conf`），**不要改它**，按 `server_name` 分流即可。

```bash
cat > /etc/nginx/conf.d/<DOMAIN>.conf <<'EOF'
server {
    listen 80;
    server_name <DOMAIN>;

    # ⚠️ Nginx 默认只允许 1M 请求体，本项目要传 PDF/Word 附件，必须放开
    client_max_body_size 50M;

    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1k;
    # ⚠️ 必须含 application/javascript，否则前端的 JS bundle 不会被压缩
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    # 后端所有接口都在 /api 前缀下，所以只需代理这一个路径
    location /api/ {
        proxy_pass http://127.0.0.1:5183;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    # 其余交给前端静态文件；找不到的路径回 index.html，交给 React Router
    location / {
        root /var/www/grad-manager/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
EOF

nginx -t && systemctl reload nginx
```

**绕开 CDN 验证 Nginx 配置是否正确**（这一步能区分「服务器问题」还是「CDN 问题」）：

```bash
curl -s -o /dev/null -w 'nginx 命中 → %{http_code}\n' -H 'Host: <DOMAIN>' http://127.0.0.1/
# 期望 200
```

### 可选：由 Nginx 自己持证书（不用 CDN 时）

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d <DOMAIN> --redirect -m <CERT_EMAIL> --agree-tos
```
certbot 会自动补 443 与 80→443 跳转，证书自动续期。

---

## 7. DNS 与 CDN（Cloudflare）

**DNS**：添加 A 记录

| 类型 | 名称 | 内容 | 代理 |
|------|------|------|------|
| A | `<DOMAIN>` 的子域部分 | `<SERVER_IP>` | 🟠 已代理（橙云） |

**SSL/TLS 模式**（Cloudflare → SSL/TLS → Overview）：

| 模式 | Cloudflare→源站 | 适用 |
|------|----------------|------|
| **Flexible** | HTTP **:80** | ✅ 源站只开了 80 时**必须选这个** |
| Full | HTTPS :443 | 源站有 443 但证书自签时 |
| Full (strict) | HTTPS :443 + 校验 | 源站有可信证书时 |

> 源站只监听 80 却选了 Full / Full(strict) → 浏览器报 **525 SSL handshake failed**。

**阿里云安全组**（这是 CDN 场景最容易漏的一步）：

| 端口 | 来源 | 为什么 |
|------|------|--------|
| 22 | 你的 IP | SSH |
| **80** | **`0.0.0.0/0`** | ⚠️ Cloudflare 的回源请求来自它的 IP 段，**只放行你自己的 IP 会导致 522** |
| 443 | `0.0.0.0/0` | 仅当 Nginx 自己持证书时需要 |
| ~~5183~~ | — | **绝不要开**，后端已绑在 127.0.0.1，外网本就访问不到 |

---

## 8. 验收

```bash
# ① 公网 HTTPS
curl -s -o /dev/null -w 'HTTPS → %{http_code}\n' https://<DOMAIN>
# 期望 200

# ② 公网真实登录
curl -s -X POST https://<DOMAIN>/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"<TEACHER_PASSWORD>"}' | head -c 120
# 期望 {"token":"eyJ...","user":{...}}

# ③ 确认后端端口没对外暴露
IP=$(curl -s http://100.100.100.200/latest/meta-data/eipv4)   # 阿里云内网元数据接口
curl -s -o /dev/null -w '5183 外网 → %{http_code}\n' -m 5 http://$IP:5183/
# 期望 000（连不上）。返回 200 说明安全组开了 5183，去关掉

# ④ 确认接口文档已关闭
curl -s --max-time 15 https://<DOMAIN>/docs | head -c 80
# 期望输出 SPA 的 <html lang="zh-CN">；
# 若出现 width=device-width, initial-scale=1.0 那是 Swagger，说明 GM_DISABLE_DOCS 没生效
```

**必须在浏览器里手工验一项**：登录 → 论文管理 → **提交一轮带附件（PDF）** → 再点附件下载。
附件传不上去就是 ⑥ 里的 `client_max_body_size` 没生效；这是本部署唯一无法用 curl 覆盖的验收点。

---

## 9. 备份

```bash
cat > /etc/cron.daily/grad-backup <<'EOF'
#!/bin/sh
D=/var/backups/grad-manager; mkdir -p $D
sqlite3 /var/lib/grad-manager/grad_manager.db ".backup $D/db-$(date +%F).sqlite3"
tar czf $D/uploads-$(date +%F).tar.gz -C /var/lib/grad-manager uploads
find $D -mtime +30 -delete
EOF
chmod +x /etc/cron.daily/grad-backup
/etc/cron.daily/grad-backup && ls -la /var/backups/grad-manager/
```

> 用 `sqlite3 .backup` 而不是 `cp`：服务运行中直接拷贝 SQLite 文件可能拿到损坏的半截数据。

---

## 10. 日常更新

```bash
cd /var/www/grad-manager
# 方式一：git pull（仓库已连 remote 时）
git pull
# 方式二：重新打包上传解压（覆盖时注意保留 backend/.venv）

cd backend && ./.venv/bin/pip install -r requirements.txt   # 依赖有变时
cd .. && chown -R www-data:www-data /var/www/grad-manager
systemctl restart grad-manager
```

前端有改动时：在开发机 `npm run build`，把 `frontend/dist/` 整个传到
`/var/www/grad-manager/frontend/dist/` 覆盖即可，**Nginx 与后端都不用重启**。

> ⚠️ 改了 `GM_SECRET_KEY`（或删掉 `grad_manager.key`）会让**所有已登录用户立刻掉线**——
> 旧 token 签名对不上。不影响数据，重新登录即可。

---

## 11. 故障排查

| 症状 | 原因 | 处理 |
|------|------|------|
| `curl -I` 返回 **405** | HEAD 请求不被 SPA 路由接受 | 正常现象，改用 `curl -s -o /dev/null -w '%{http_code}'` |
| `curl` 返回 **000** | 连不上：域名未解析 / 安全组未放行 / CDN 回源失败 | 依次查 `dig +short <DOMAIN>`、安全组 80、Cloudflare 代理状态 |
| 浏览器 **522** | Cloudflare 连不到源站 | 安全组 80 未对 `0.0.0.0/0` 放行 |
| 浏览器 **525** | SSL 模式与源站不匹配 | 源站没 443 → Cloudflare 改 `Flexible` |
| 浏览器 **502** | Nginx 通了但后端没起来 | `systemctl status grad-manager --no-pager`；看 `journalctl -u grad-manager -n 50` |
| 附件上传失败 / **413** | `client_max_body_size` 未生效 | 确认那行写在**这个域名自己的 server 块**里（写在别的 server 块里不生效） |
| `/docs` 仍能打开 Swagger | `GM_DISABLE_DOCS` 未生效 | 确认在 `/etc/grad-manager.env` 里且 `systemctl restart grad-manager` 过 |
| 登录返回 **401** | 密码不对 | 注意 `GM_SEED_PASSWORD` 只在首次建库时生效，之后改它没用 |
| 服务起不来，日志报 `.venv` 相关错误 | 误把开发机的 `.venv` 传上来了 | 删掉 `backend/.venv`，在服务器上重新 `python3 -m venv .venv` |
| 学生看不到别人的项目 / 反过来能改别人数据 | — | 这是后端鉴权问题，不是部署问题，见 `README.md` 第五节 |

**排查时最有用的一条命令**：

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: <DOMAIN>' http://127.0.0.1/
```

返回 200 = **服务器侧完全正常**，问题在 CDN/安全组；返回 502 = 后端没起来。

---

## 12. 为什么这么配（改配置前先读）

- **后端只绑 `127.0.0.1:5183`**：外网无法直连，所有流量必须经过 Nginx，避免绕过 HTTPS。
- **Nginx 只代理 `/api/`**：后端所有路由都注册在 `/api` 前缀下（`main.py` 会拒绝 `api/` 开头的 SPA 回退），所以静态与接口能干净分流。
- **数据放 `/var/lib/` 而非代码目录**：重新解包覆盖代码时不会碰到数据库；备份路径固定。
- **不打包 `.venv`**：Python 虚拟环境含平台相关二进制，跨平台不可移植。
- **不打包 `grad_manager.key`**：每台机器应有自己的密钥；混用会导致 token 在不同环境互认。
- **用 systemd 而不是 pm2**：pm2 面向 Node；systemd 已完成开机自启 + 崩溃重拉，两套守护并存会互相抢进程。
