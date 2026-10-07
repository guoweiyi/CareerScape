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

打开 `http://127.0.0.1:3000`。默认 `AI_PROVIDER=mock`，界面显示模拟对话；无需模型密钥。不要把密钥发到聊天或提交到Git。环境变量见 `.env.example`。数据库默认在进程工作目录 `.data/`，需要跨CLI/服务使用同一库时显式设置绝对 `DATABASE_PATH`。生产运行前阅读 [后端说明](docs/backend.md)。

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

不要在正在运行的开发服务器上同时执行 `build`/`prepare`/`typecheck`（它们会重写Nuxt生成目录）。先停开发服务，执行检查，再启动。

## 内容与后台

游客可直接体验；用户名/Argon2id密码注册，注册后显示一次性恢复码。游客存档仅在明确勾选认领后转移。账号页支持导出与删除。后台无默认账号、无默认密码：先注册，再由服务器操作者执行 `pnpm exec tsx scripts/db.ts bootstrap-admin <用户名>` 授权；打开 `/admin`。

内容版本固定，发布需通过schema、路线、资源哈希/许可门禁。后台支持复制草稿、结构编辑、检查、审核、发布、入口回退；玩家私聊和手账不提供后台阅读接口。

参见 [内容生产](docs/content-library.md)、[叙事与协议](docs/narrative-protocol.md)、[API](docs/api.md)、[美术方向](docs/art-direction.md)、[美术权利记录](ASSET_LICENSES.md)、[交付日志](docs/delivery-log.md)。后续阶段与完整验收证据在 `docs/roadmap.md`、`docs/requirements-traceability.md` 和 `docs/verification.md`。

尚未部署。真实AI质量/成本、真实微信WebView、真机软键盘与行业人工审核需对应环境另验。音频延期，首版无声可完整游玩。代码与美术授权分别记录，不将代码许可证自动套用于图片。
