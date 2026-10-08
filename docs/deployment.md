# 部署准备与回滚

当前交付没有部署到公网，没有创建云资源或购买服务。首版支持一个 Node 24 写进程和本机持久磁盘上的 SQLite。域名、HTTPS 证书、备份介质、真实 AI 额度由实际运维环境提供。

## Docker 运行

仓库包含多阶段 `Dockerfile`、`.dockerignore` 和 `compose.yaml`。构建阶段使用Node 24.16.0与pnpm 12.6.0，在Linux安装原生依赖；运行阶段只复制Nitro输出、图片、许可记录和管理员运维脚本，不包含源码开发依赖、本地数据库或凭据。首轮自动交付验证平台为`linux/amd64`。

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 careerscape
```

默认仅绑定本机`127.0.0.1:3000`，mock对话，不调用付费模型。`CAREERSCAPE_PORT`可更改宿主机端口。运行用户固定UID/GID 1000，根文件系统只读；SQLite写入`/data/careerscape.sqlite`，对应Compose命名卷`careerscape-data`。新卷继承`/data`所有者；已有卷必须由操作者核对权限后让UID 1000可写，容器不会自动递归改权限或使用777。不要将同一个SQLite卷交给多个写服务。

已有Docker Hub镜像时可以拉取并运行；只有Actions推送成功后目标标签才可用：

```sh
docker compose pull
docker compose up -d --no-build
```

默认镜像`yunyunjuan/careerscape:latest`跟随仓库默认分支。长期环境应把`CAREERSCAPE_IMAGE`设为已核验的`sha-完整GitSHA`标签或`image@sha256:digest`；从Actions发布摘要或Docker Hub记录实际值，不把可变latest当作回退标识。发布触发、仓库机密、标签和下载artifact见[CI/CD说明](ci-cd.md)。从artifact解压后可先用`sha256sum --check careerscape-image.sha256`校验，再`docker load --input careerscape-image.tar.gz`，设置`CAREERSCAPE_IMAGE=careerscape:ci`后用`--no-build`启动。

公开部署时在服务前配置HTTPS代理，显式设置`APP_ORIGIN`为实际HTTPS来源，并设置`COOKIE_SECURE=true`。Compose中的`false`仅供loopback预览，应用会拒绝在公网主机降级Cookie。AI默认固定mock；真实模型需另行调整部署配置、注入服务端密钥并完成模型验收，构建镜像时不传入API密钥。

内容后台没有默认账号。先注册普通账号，再由容器操作者授权：

```sh
docker compose exec careerscape node /app/server/container-admin.mjs 已注册用户名
```

此命令只给已有正式账号授予editor/reviewer/admin，并记录审计；不创建账号、不读取密码。开发用`pnpm`/`tsx` CLI没有进入运行镜像，不能直接在容器里运行源仓库的`pnpm db:backup`。备份应使用具备SQLite在线备份能力的运维工具，或停写后完整备份持久卷并验证恢复。停止容器用`docker compose down`；`down --volumes`会删除命名卷数据，不能作为更新或回滚步骤。

容器自检：先`docker build -t careerscape:ci .`，再`node scripts/docker-smoke.mjs careerscape:ci`。脚本仅使用随机命名的临时容器/卷，验证非root、健康检查、SQLite/Argon2、游客认领、真实动作、固定资产hash、管理员审计，以及重启和重建容器后存档仍存在；结束后只清理自己的测试资源。

## 构建与启动

```sh
pnpm install --frozen-lockfile
pnpm prepare
pnpm typecheck
pnpm exec tsc --noEmit
pnpm lint
pnpm test
node scripts/art/verify.mjs v1
node scripts/art/verify.mjs v2
pnpm build
```

部署完整 `apps/web/.output/`（server 与 public 都需要）。在目标输出目录运行：

```sh
NODE_ENV=production HOST=127.0.0.1 PORT=3000 \
APP_ORIGIN=https://your-domain.example \
DATABASE_PATH=/var/lib/careerscape/careerscape.sqlite \
ASSET_PUBLIC_DIR=/opt/careerscape/current/public \
AI_PROVIDER=mock node server/index.mjs
```

这是 Linux 环境示例，替换为实际域名及路径。服务用户只需读取部署目录、写入专用数据库/备份目录。由 systemd 等进程管理器管理单写服务。不要在多个容器的临时磁盘分别建立同名数据库，也不要用共享网络盘替代数据库扩容。

本地 Windows 生产预览可在 PowerShell 先设置 `$env:COOKIE_SECURE='false'`、`$env:APP_ORIGIN='http://127.0.0.1:3000'`，再 `pnpm preview`。该 Cookie 降级仅允许 loopback，公网仍强制 Secure。开发服务用 `pnpm dev`。Windows 下重建前先停止运行中的输出服务，避免 native DLL 锁定 `.output` 文件。

## Nginx 示例

TLS 证书配置由运维环境提供，以下放入已有 HTTPS server 块。应用自身对私有页面与所有 API 发出 no-store；代理不能覆盖为公共缓存。

```nginx
client_max_body_size 512k;
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_buffering off;
  proxy_read_timeout 60s;
  proxy_send_timeout 60s;
}
```

对 `/admin` 与 `/api/admin/` 在网络层施加管理员网段/VPN限制；应用层角色校验仍然必要。配置反向代理连接和请求速率限制。真实代理部署后再验证 Cookie、Origin、断流、缓存、请求体上限和重连；此示例没有被冒称为已上线验证。

## 发布与恢复

1. 保留旧 release 和其全部 hash 命名素材，先完成数据库在线备份与恢复验证，命令见 `backend-operations.md`。
2. 在维护窗口停止唯一写服务，切换完整输出目录；保持 `DATABASE_PATH` 不变。
3. 启动后检查 `/api/health`、目录、游客新局、已有账号存档、旧版本资源、管理员入口限制。
4. 应用回滚切回已保留 release。内容回退在工作台操作，只改新局入口，旧会话仍绑定原版本。不能覆盖已发布图片或内容正文。
5. 数据恢复只能从校验过的新副本开始，重放账号删除指纹并撤销恢复出的设备会话。明确评估 schema 兼容后才切换在线路径；不直接覆盖活库。

数据库、备份、凭据、真实私聊/手账均不进入 Git。`.env.example` 没有真实密钥。生产备份需受控加密存储并执行30天保留策略；项目没有自动采购或配置云备份。
