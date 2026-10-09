# 职境漫游 CareerScape

面向大学生的职业体验 H5：先走进一个虚构工作日，再想象未来。Nuxt 4 / Vue / Nitro / TypeScript / SQLite / Drizzle。

首包《上线前的最后一小时》：在栖木工作室扮演软件测试新人，与林澄、周砚、许知协作处理校园活动报名的重复记录。验证交付、协商范围、交接下班三条路线；可选手账，无职业适配分数。组织、人物、材料均原创合成，行业核验尚未完成。

新增 `/galgame` **AI 职业故事**：可选测试、前端、产品，以及实习生、应届新人或转行身份。AI 现场生成场景、选项和同事回应；可以自由行动、私聊、提交岗位工作产物、回溯路线，并依据实际记录生成就业复盘。复用现有登录、会话、手账、存档与美术；此模式支持 Vercel Google 原生适配器；配置 `AI_PROVIDER=google`、`GOOGLE_GENERATIVE_AI_API_KEY`、`GOOGLE_MODEL` 与可选 `GOOGLE_BASE_URL` 后，先执行 `pnpm ai:smoke` 和 `pnpm galgame:smoke`。模板默认关闭，没有 mock 回退。配置、外部引擎研究、接口与验证范围见 [AI 职业故事说明](docs/galgame.md)。

[本地运行](#本地运行) · [贡献指南](#贡献指南) · [Issues](https://github.com/guoweiyi/CareerScape/issues) · [Pull Requests](https://github.com/guoweiyi/CareerScape/pulls)

## 本地运行

需要 Node 24.16.0、pnpm 12.6.0（具体见 [版本矩阵](docs/VERSION-MATRIX.md)）。

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
```

打开 `http://127.0.0.1:3000`。默认 `AI_PROVIDER=mock`，界面显示模拟对话；无需模型密钥。不要把密钥发到聊天或提交到Git。环境变量见 `.env.example`。仓库运行默认数据库为 `.data/careerscape.sqlite`；跨CLI/服务建议导出同一个绝对 `DATABASE_PATH`。生产运行前阅读 [部署说明](docs/deployment.md) 与 [后端说明](docs/backend-operations.md)。

```sh
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

不要在正在运行的开发服务器上同时执行 `build`/`prepare`/`typecheck`（它们会重写Nuxt生成目录）。先停开发服务，执行检查，再启动。

## Docker 与自动交付

从源码在本机运行（Docker Desktop 使用 Linux 容器）：

```sh
docker compose up -d --build
docker compose ps
```

访问 `http://127.0.0.1:3000`。服务以非root用户运行，SQLite保存在命名卷中；默认mock。停止用 `docker compose down`，保留数据时不要加 `--volumes`。

GitHub Actions 按 check → docker → deploy 执行：应用和容器验收通过后，直接通过 SSH 上传同一份已验证镜像，在服务器 Docker 加载并启动。默认分支推送自动部署，PR 只验证；手动运行 **CI and Deployment** 可勾选 `deploy`。生产入口使用 HTTPS，SQLite 数据保存在固定卷中；详见 [CI/CD](docs/ci-cd.md) 与 [部署说明](docs/deployment.md)。

完整触发/标签规则见[CI/CD说明](docs/ci-cd.md)，生产参数、持久卷与镜像回退见[部署说明](docs/deployment.md)。参与开发请阅读[贡献指南](CONTRIBUTING.md)。

## 内容与后台

游客可直接体验；用户名/Argon2id密码注册，注册后显示一次性恢复码。游客存档仅在明确勾选认领后转移。账号页支持导出、校验导入与删除。后台无默认账号、无默认密码：先注册，再由服务器操作者执行 `pnpm exec tsx scripts/db.ts bootstrap-admin <用户名>` 授权；打开 `/admin`。

内容版本固定，发布需通过schema、路线、组局、资源哈希/许可门禁。后台支持复制草稿、图形节点编辑与高级JSON、检查、审核、发布、入口回退、seed预览与mock批次预算/续跑；只显示主动提交的自愿反馈，不提供玩家私聊和手账阅读接口。空库以v2开局，同时保留v1历史包；已有库升级不会擅自改变已发布入口。

本轮新增[结局回顾](docs/endings.md)：从“我的旅程”或终局进入，只展示本人已提交的结局，回看链接保留原分支。内容工作台的[节点视图](docs/studio-editor.md)可编辑已有节点的对白、背景、解释和选项去向，并提示结构问题与未保存修改；新增/删除节点、拖拽及批量导入仍待实现。

剧情操作区提供“逐段阅读”：默认手动，可选阅读速度和自动翻段。它只阅读当前回合已提交的对白，读完、关闭、页面隐藏或回合变化即停止，不替玩家作选择。纯文字、低流量和减少动态模式均可使用。

参见 [产品与ADR](docs/product-and-architecture.md)、[用户/管理手册](docs/user-admin-guide.md)、[内容生产](docs/content-library.md)、[叙事与协议](docs/narrative-protocol.md)、[API](docs/api.md)、[存档恢复](docs/content-archive.md)、[美术方向](docs/art-direction.md)、[美术权利记录](ASSET_LICENSES.md)、[交付日志](docs/delivery-log.md)。[25主题追踪](docs/requirements-traceability.md)、[实际验收](docs/verification.md) 和 [P1/P2路线图](docs/roadmap.md) 区分已完成与条件验证。

美术已包含12张透明半身、3个同源头像及4个独立横/竖背景，共38个WebP，约4.49MB；21张实际PNG母版保存在本地 `art/source/`（42.09MB，Git忽略）。仓库保留可部署资源、不可变manifest、生成提示/引用链与hash，母版尚未上传远程存储。运行截图在 `docs/screenshots/`。

尚未部署。真实AI质量/成本、真实微信WebView、真机软键盘与行业人工审核需对应环境另验。音频延期，首版无声可完整游玩。代码与美术授权分别记录，不将代码许可证自动套用于图片。

## 贡献指南

欢迎通过 [Issue](https://github.com/guoweiyi/CareerScape/issues) 报告问题、讨论功能，通过 [Pull Request](https://github.com/guoweiyi/CareerScape/pulls) 贡献代码、测试、文档、职业内容或有明确授权的素材。首次参与请阅读 [详细贡献指南](CONTRIBUTING.md) 和 [需求追踪](docs/requirements-traceability.md)，了解已经实现的功能及待验证的范围。

### 从问题到 PR

1. **说明问题或目标。** Bug 请提供复现步骤、预期与实际结果、运行环境；新职业、大范围重构、依赖升级或部署调整先通过 Issue 讨论方案。截图和示例使用合成数据，避免包含真实玩家内容。
2. **建立独立分支。** 外部贡献者先 Fork [本仓库](https://github.com/guoweiyi/CareerScape/fork)，从实际默认分支创建 `feat/xxx`、`fix/xxx` 或 `docs/xxx`；有写权限也使用独立分支，不直接推送默认分支。默认分支以仓库设置为准，不假定为 `main`。
3. **完成范围明确的改动。** 使用 Node.js 24.16.0 和 pnpm 12.6.0，按锁文件安装依赖。优先复用现有账号、会话、存档和 Zod 契约；数据库变更提供迁移，已发布内容与资源保留旧版本。相关测试和文档随改动更新，不混入无关格式化或依赖升级。
4. **验证实际行为。** 按 [本地运行](#本地运行) 的命令完成类型检查、lint、单元测试、素材核验、生产构建和浏览器验收。测试使用隔离数据库；浏览器回归使用本地模型 fixture，不需要真实 AI Key。涉及真实模型时另行配置服务端环境变量，明确调用范围与费用，并将真实结果与模拟结果分开说明。纯文档改动核对命令、路径与链接即可，说明未运行程序测试的原因。
5. **提交 PR，等待维护者审核。** 标题说明具体结果，例如 `fix(saves): 修复分支存档恢复`；描述按 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md) 写清问题、最终行为、影响范围、验证结果及未覆盖项。提交信息可使用 Conventional Commits 前缀，正文使用中文。维护者审核并确认后再合并，贡献者不自行触发生产部署。

### 提交前核对

- 界面变更附手机与桌面截图；API、权限、事务、存档或内容版本变更说明兼容性和回退方式。
- 不提交 `.env`、API Key、SSH 私钥、Cookie、恢复码、数据库、备份或真实玩家导出文件；提交前检查暂存区，而不只依赖 `.gitignore`。部署参数由维护者通过 GitHub Secrets 配置。
- 职业事实和素材说明来源、使用权及审核状态；自动检查不替代行业审核，不承诺就业结果或职业适配结论。
- PR 和功能分支只运行验证；CI 通过不等于已经部署。工作流与生产运维分别见 [CI/CD](docs/ci-cd.md) 和 [部署说明](docs/deployment.md)。
