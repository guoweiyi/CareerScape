# CI/CD：验收后直接部署 Docker

参考 `D:/image/ts/agent` 的检查、生产构建、隔离数据库/恢复和浏览器验收思路，保留 CareerScape 的 pnpm/Node 工具链及容器自检。当前流程为 **check → docker → deploy**，不使用镜像发布仓库。

## 触发与门禁

PR、所有分支推送、v* 标签及手动运行完成类型、lint、单元测试、固定素材、生产构建和浏览器验收。随后构建 linux/amd64 镜像，验证非 root、SQLite/Argon2、资产、登录、存档以及容器重启/重建和数据库备份恢复。

只有原仓库默认分支推送，或默认分支手动运行并勾选 `deploy`，才部署服务器。默认分支目前是 `feat/h5-mvp`。部署前检查最新分支提交，过时提交不更新服务器。docs/README/贡献说明的纯文档修改仍按 paths-ignore 跳过。

工作流为 `.github/workflows/ci.yml`，显示名 **CI and Deployment**。官方 Actions 固定提交 SHA。权限默认 contents:read，生产 SSH 凭据仅传入 deploy 步骤；不使用 pull_request_target。新运行不能取消正在更新服务器的任务，deploy 使用 production 并发组，服务器另加 flock。

## 同一镜像直接交付

Docker 验收通过后，`scripts/deploy/package-image.mjs` 将该镜像标记为 `careerscape:sha-完整GitSHA`，打包为 `careerscape-image.tar.gz`。同一次运行的 artifact 同时保存文件校验、镜像 ID、提交 SHA、部署脚本和生产 Compose 的 SHA-256，保留 7 天。发布阶段没有二次构建。

Deploy 下载本次 artifact、验证压缩包，通过 OpenSSH/SCP 上传 `/opt/careerscape/releases/<sha>/`。文件先上传为 .part，再更名。服务器再次校验清单与实际镜像 ID、revision/platform；docker load 后使用 Compose --no-build --pull never 启动。无需 Docker Hub/GHCR 凭据。

## 配置与服务器

GitHub repository Secrets：`DEPLOY_SSH_KEY` 为专用部署私钥，`DEPLOY_KNOWN_HOSTS` 为已经核对的服务器公钥记录。机密缺失、连接失败、校验失败、上线失败均令 deploy 失败，不能用绿色 CI 表示已上线。

目标为 `root@64.83.12.37:22`。本机因网络限制，经 WLAN 的 Termux SSH 跳板核查服务器；GitHub 托管 runner 直接连接服务器，不依赖私有 WLAN 地址。首次配置已经授权使用密码引导，后续自动交付使用公钥；密码和私钥不提交到仓库。

生产配置位于服务器 `/opt/careerscape/`：app.env 仅保存服务端 AI 配置，deploy.env 保存固定端口、HTTPS origin 与代理镜像 ID。Google 配置沿用本机已验收的 Google 原生接口；CI 使用隔离 fixture，不读生产 AI 密钥。

## HTTPS、备份与回退

应用使用固定 loopback 3300、一个 Node 写进程和固定 careerscape-data 卷。独立 Caddy 容器占用已核查空闲的 443，使用 Let's Encrypt shortlived IP 证书、TLS-ALPN 验证及自动续期，不占用已有应用的 80。证书/ACME 状态保存到独立卷。APP_ORIGIN 为实际 HTTPS 来源，Secure Cookie 不降级。

更新时开启维护页，停止旧写进程，调用运行镜像的 container-db.mjs 进行不触发迁移的备份和完整性检查，再启动新镜像。Docker healthy、schema 版本、固定素材和可信 HTTPS 均通过才开放玩家访问。公开 health 可以穿过维护页，以便在恢复写入前验证 TLS。

激活前失败，自动恢复校验过的数据库及上一镜像；失败数据库保留，不删除。首次失败保持维护状态。恢复玩家写入后的故障不自动用旧备份覆盖数据；维护期间由操作者评估 schema 与新数据再恢复。

部署结果写入服务器 current.json 和 Actions 摘要，关联 Git SHA、镜像 ID、运行编号和地址。至少保留当前及上一成功版本；不要执行全局 Docker prune 或 compose down --volumes。受控备份的加密、异地复制、30 天保留及删除指纹重放按 backend-operations.md 执行，首次上线不冒称已配置异地备份。
