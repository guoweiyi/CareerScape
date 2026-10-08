# 职境漫游 CareerScape

面向大学生的职业体验 H5：先走进一个虚构工作日，再想象未来。Nuxt 4 / Vue / Nitro / TypeScript / SQLite / Drizzle。

首包《上线前的最后一小时》：在栖木工作室扮演软件测试新人，与林澄、周砚、许知协作处理校园活动报名的重复记录。验证交付、协商范围、交接下班三条路线；可选手账，无职业适配分数。组织、人物、材料均原创合成，行业核验尚未完成。

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

## 内容与后台

游客可直接体验；用户名/Argon2id密码注册，注册后显示一次性恢复码。游客存档仅在明确勾选认领后转移。账号页支持导出、校验导入与删除。后台无默认账号、无默认密码：先注册，再由服务器操作者执行 `pnpm exec tsx scripts/db.ts bootstrap-admin <用户名>` 授权；打开 `/admin`。

内容版本固定，发布需通过schema、路线、组局、资源哈希/许可门禁。后台支持复制草稿、图形节点编辑与高级JSON、检查、审核、发布、入口回退、seed预览与mock批次预算/续跑；只显示主动提交的自愿反馈，不提供玩家私聊和手账阅读接口。空库以v2开局，同时保留v1历史包；已有库升级不会擅自改变已发布入口。

本轮新增[结局回顾](docs/endings.md)：从“我的旅程”或终局进入，只展示本人已提交的结局，回看链接保留原分支。内容工作台的[节点视图](docs/studio-editor.md)可编辑已有节点的对白、背景、解释和选项去向，并提示结构问题与未保存修改；新增/删除节点、拖拽及批量导入仍待实现。

参见 [产品与ADR](docs/product-and-architecture.md)、[用户/管理手册](docs/user-admin-guide.md)、[内容生产](docs/content-library.md)、[叙事与协议](docs/narrative-protocol.md)、[API](docs/api.md)、[存档恢复](docs/content-archive.md)、[美术方向](docs/art-direction.md)、[美术权利记录](ASSET_LICENSES.md)、[交付日志](docs/delivery-log.md)。[25主题追踪](docs/requirements-traceability.md)、[实际验收](docs/verification.md) 和 [P1/P2路线图](docs/roadmap.md) 区分已完成与条件验证。

美术已包含12张透明半身、3个同源头像及4个独立横/竖背景，共38个WebP，约4.49MB；21张实际PNG母版保存在本地 `art/source/`（42.09MB，Git忽略）。仓库保留可部署资源、不可变manifest、生成提示/引用链与hash，母版尚未上传远程存储。运行截图在 `docs/screenshots/`。

尚未部署。真实AI质量/成本、真实微信WebView、真机软键盘与行业人工审核需对应环境另验。音频延期，首版无声可完整游玩。代码与美术授权分别记录，不将代码许可证自动套用于图片。
