# 参与 CareerScape 开发

先阅读 [README](README.md) 与[需求追踪](docs/requirements-traceability.md)，确认要解决的问题、当前实现和所属阶段。用一项可以独立说明、验证和回退的功能组织变更；不要用空页面代替尚未实现的能力。

## 开发环境

项目验证基线为 **Node.js 24.16.0、pnpm 12.6.0**。`package.json` 的 `packageManager` 与 `pnpm-lock.yaml` 固定包管理器和依赖版本；依赖升级应单独说明兼容性、原生模块及浏览器验证结果，避免顺带刷新整个锁文件。

在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
```

默认地址为 `http://127.0.0.1:3000`。默认 `AI_PROVIDER=mock`，不用配置模型密钥，也不会产生模型调用费用。环境变量名称见 [.env.example](.env.example)；如需修改配置，请复制到本地 `.env` 或显式导出环境变量。独立 CLI 和已构建的 Node 服务不要假定会自动读取 `.env`，应显式传入同一个 `DATABASE_PATH`，跨工作目录运行时使用绝对路径。

本地使用 SQLite，默认数据位于 `.data/careerscape.sqlite`。`db:seed` 加载原创合成首包并检查真实美术资源；资源未就绪时目录显示筹备中，不能把门禁删掉或改成占位发布。不要让自动测试连接自己的长期试玩库或生产数据库。

内容后台没有默认管理员账号。先在本地网页注册，再由实例操作者授予这个测试账号内容角色：

```sh
pnpm exec tsx scripts/db.ts bootstrap-admin 已注册用户名
```

该命令不是公开注册流程，也不能用于绕过服务器访问控制。内容编辑操作见[工作台手册](docs/user-admin-guide.md)和[图形编辑说明](docs/studio-editor.md)。

## 分支、提交与拉取请求

从仓库**实际默认分支**建立功能或修复分支。默认分支由仓库设置决定，不预设为 `main`；创建 PR 时也要核对目标分支，不擅自改默认分支、合并策略或历史。

外部贡献者先 Fork 仓库；有写权限也使用独立分支，通过 PR 合入，不直接推送默认分支、不擅自合并或部署。较大功能、依赖升级、重构与部署调整先用 Issue 讨论目标与方案。

每个独立功能分别提交，提交标题说明具体结果，例如 `feat(studio): 同步选项目标与作者图边`。相关测试和文档随功能提交，避免将无关格式化、依赖升级、生产配置改动混入同一提交。已有 featureId 的工作沿用原标识，新功能在交付记录中使用稳定标识。提交信息可使用 Conventional Commits 前缀，正文使用中文；核对实际远端 SHA 与对应 CI 状态，不能用本地通过代替推送或 CI 成功。

PR 标题和描述使用中文，并按[模板](.github/PULL_REQUEST_TEMPLATE.md)写清问题、最终行为、影响范围、实际验证及尚未覆盖的环境。界面变更附手机/桌面证据；事务、身份、资源、内容版本变更说明兼容性与回退方式。提供复现步骤比粘贴完整日志更有用；截图和日志必须去掉凭据与个人内容。

使用 AI 或自动化协作者时，先提供本地差异、中文提交/PR 文案和验证结果供维护者审核；未经明确确认，不提交、推送或创建 PR，也不操作线上环境。维护者审核并确认后再合并，部署另行确认。

## 代码与数据边界

- 保持 Nuxt 和根 TypeScript 严格检查。跨边界输入使用现有 Zod 契约；不要用 `any` 或关闭规则掩盖类型问题。
- 浏览器只能导入共享契约、纯函数或服务类型，不能导入数据库连接、模型凭据或服务端运行时代码。
- 世界状态由服务端白名单规则裁定。模型输出是候选文本，不能执行任意脚本、网络请求、SQL 或直接写入状态；真实模型验证需要单独配置和明确预算。
- 事件、状态、快照和回执保持事务边界。保留动作幂等、分支 revision、生成租约和断线查询恢复；文字 delta 不能更新权威状态。
- 数据库变更新增迁移，并同步受控迁移入口及对应 schema，不重写已经使用的迁移来冒充升级。涉及归属、删除或恢复时使用真实 SQLite 测试，不能只依赖 mock。
- 修复已知问题时覆盖实际触发条件。不要为可逆的小文案改动堆砌镜像实现的测试；也不要以页面按钮被隐藏代替后端授权测试。

相关设计见[产品与架构](docs/product-and-architecture.md)、[叙事和协议](docs/narrative-protocol.md)、[数据与运行手册](docs/backend-operations.md)。

## 内容、美术与隐私

已发布内容包和绑定的资源版本不可原地覆盖。修改已发布剧情应复制成新草稿，经检查、审核和发布成为新版本；保留旧包、冻结 manifest 与被旧存档引用的文件。入口回退只影响新开局，不重抽旧局人物、不重新生成历史对白。

新增职业事实和内容应记录来源、使用范围、权利状态、合成假设及审核状态。自动检查不等于行业专家审核；当前首包是原创合成演示，不能写成真实企业规则、就业保证或职业适配诊断。离线候选 mock 不等于真实模型生成，真实模型的账单和延迟也不能从 mock 推算。

美术变更同时维护逻辑资源 ID、版本清单、实际文件哈希、尺寸、透明通道、移动端变体与许可记录。仓库需要可部署的压缩图和可核验的来源记录；不要覆盖旧版文件或把代码许可自动套用于图片。制作边界见[美术方向](docs/art-direction.md)和[素材权利记录](ASSET_LICENSES.md)。

玩家私聊、手账、探索顾虑默认仅本人可见。后台角色不自动获得私密内容，模型上下文只包含角色有权接收的信息。新增导出、日志、反馈、统计或支持功能时，检查字段级范围、本人归属、Origin/CSRF、缓存和删除行为；不要把真实玩家记录放入测试夹具、问题单、CI artifact 或模型提示。

以下内容不得提交：`.env`、API key、Docker Hub token、SSH 私钥、部署凭据、Cookie、恢复码、SQLite 数据库及 WAL、备份、真实玩家导出文件、含敏感信息的日志。`.gitignore` 只是辅助，提交前仍需检查暂存区。需要修复凭据泄漏时，先撤销或轮换凭据，再按仓库维护流程清理；只删一行提交不能撤销已经泄漏的凭据。

## 验证变更

先运行与变更直接相关的用例；提交可执行变更前完成当前 CI 门禁：

```sh
pnpm prepare
pnpm typecheck
pnpm exec tsc --noEmit
pnpm lint
pnpm test
node scripts/art/verify.mjs v1
node scripts/art/verify.mjs v2
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Linux CI 安装浏览器及系统依赖时使用 `pnpm exec playwright install --with-deps chromium`。Playwright 启动生产构建、使用隔离的测试 SQLite 与 mock，不需要真实 AI 密钥，并占用 `127.0.0.1:3100`；执行前完成构建并确认端口空闲。结果产物留在忽略目录。

不要在开发服务器运行时同时执行 `build`、`prepare` 或 `typecheck`，它们会重写 Nuxt 生成目录。格式化可针对改动文件运行 `pnpm exec prettier --write <文件>`，避免引入无关改动。

纯文档变更核对命令、路径、链接和实现口径即可，并在 PR 中说明未重跑程序测试的原因。最终执行结果写入[验收记录](docs/verification.md)或相应交付记录，明确区分本地、CI、模拟测试、真实模型和生产环境。测试存在不等于测试已运行。

## 镜像与发布

目标镜像为 `docker.io/yunyunjuan/careerscape`。CI 检查和 Docker Hub 发布边界见 [CI/CD 说明](docs/ci-cd.md)，运行部署见[部署说明](docs/deployment.md)。

Docker Hub 用户名和 access token 由有权限的维护者填写到 GitHub Actions Secrets：`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`。不要在 PR、聊天、仓库文件或工作流明文中提供凭据。PR 验证不应依赖发布凭据；镜像发布与实际部署是不同操作，发布成功不代表应用已经上线。
