# 需求到交付的追踪表

状态口径：**已实现并测**指存在代码且对应测试已运行；**已实现待集成验收**指文件存在但不能仅据此认定完整流程通过；**条件验证**指依赖真实密钥、生产环境或外部审核；**待交付**不等于 P1。本表只维护需求映射；所有测试数量、最终命令、浏览器证据、未测项均以[最终验收记录](verification.md)为准，提交与远端状态见[持续交付日志](delivery-log.md)。本表覆盖原始需求的 25 类主题，避免用大量空页面冲抵交付。

| ID / 主题 | 需求范围 | 实际权威文件 / 接口 / 测试 | 阶段 | 状态与限制 |
|---|---|---|---|---|
| R01 定位、价值与执行边界 | 大学生职业探索、故事优先、非诊断、原创组织 | `docs/implementation-scope.md`、`packages/content/seed.ts`、首页 | P0 | 内容已实现；未宣称就业率或教育效果 |
| R02 用户旅程与完整链路 | 游客→岗位→组局→选择→保存→分支→下班→手账→认领 | `apps/web/app/pages/`、`apps/web/server/api/` | P0 | 代码已实现；跨层浏览器证据见验收记录 |
| R03 PRD、分期与路线图 | P0 与 P1/P2 保留，优先级和前置条件 | `docs/implementation-scope.md`、`docs/roadmap.md` | P0/P1/P2 | 文档已交付，未来能力没有伪装成按钮 |
| R04 锁版本与依赖兼容 | Nuxt 4、Vue、UI/Tailwind、SDK、数据库、测试 | `package.json`、`pnpm-lock.yaml`、版本矩阵文档 | P0 | 已锁版本；实际类型/构建结果见验收记录 |
| R05 工程分层与渲染边界 | 浏览器不导入凭据/数据库，SSR 公开页与私有 no-store | `apps/web/nuxt.config.ts`、`apps/web/server/utils/api.ts`、packages 分层 | P0 | 生产构建与本地浏览器缓存头检查通过；实际CDN/HTTPS代理条件验证 |
| R06 作者图与白名单 DSL | DAG、条件/效果、合流、节点类型、访问实例 | `packages/contracts/index.ts`、`packages/narrative/engine.ts`、`tests/domain.test.ts` | P0 | 领域测试通过；没有 eval 或任意配置脚本 |
| R07 真实首包剧本与人物 | 3 NPC、8 作者节点、3 结局、职责片段 | `packages/content/seed.ts`、`docs/narrative-protocol.md` | P0 | 三条标准路线/帮助/退出/职责信息差实测通过 |
| R08 玩家分支与回溯 | parentBranchId/forkEventSeq、共享前缀、真实文本回放、个人归档恢复 | `apps/web/server/services/game.ts`、`services/archive.ts`、`/api/sessions/:id/fork`、`/api/account/import`、`tests/archive.test.ts` | P0 | 归档实际回放、版本与引用校验已实现；512,000 字节网页导入上限和更大文件限制见 `docs/content-archive.md`；执行结果见验收记录 |
| R09 职业 Profile、来源与事实 | 合成标识、职责权限、来源用途与专业审核分离 | `packages/content/seed.ts`、数据库 sources/facts/profiles | P0 | 合成边界已交付；行业审核 pending |
| R10 内容批次与候选 | plan/generate/validate/publish、预算、游标、续跑、去重 | `packages/content/pipeline/index.ts`、`scripts/content/cli.ts`、`services/batches.ts`、`tests/domain-pipeline.test.ts`、`tests/backend-batches.test.ts` | P0 | SQLite mock 管线与工作台批次预算/续跑已实现；非真实模型生成；执行结果见验收记录 |
| R11 受约束组局与冻结 | 已发布库、seed、角色/条件/互斥/冷却、固定包回退 | `packages/narrative/engine.ts`、`packages/content/assembly/index.ts`、领域测试 | P0 | 测试通过；人物池仅 3 名且固定职责，不夸大组合能力 |
| R12 在线 AI 与角色上下文 | 真实 provider 接口+mock、事实/收件范围过滤、预算、工具白名单 | `packages/agent/index.ts`、服务层 model_calls | P0/P1 | mock 可测试；真实密钥、生成质量与费用/延迟为条件验证 |
| R13 JSONL 与流恢复 | UTF-8/半行/CRLF/大小/schema/seq/duplicate/end、完整消息生命周期与长对话预算 | `packages/contracts/protocol.ts`、`tests/protocol.test.ts`、`tests/backend-capacity.test.ts`、action/turn 接口 | P0 | 文字 delta 无权修改状态；消息窗口与快照有独立字节上限；执行结果与生产代理未测限制见验收记录 |
| R14 并发、事务与任务租约 | 同 ID 同正文幂等、异正文冲突、revision、唯一性、崩溃恢复 | `packages/database/migrations/0001_initial.sql`、`services/game.ts`、`tests/backend.test.ts` | P0 | 服务层实现；真实事务测试结果见验收记录 |
| R15 登录与游客归属 | 服务端游客、密码哈希、Cookie、恢复码、认领 | `services/auth.ts`、`/api/auth/*`、账号页面 | P0 | 一种实际认证方式；导入强制使用当前身份，不接收角色或认证信息；没有接入邮件/手机号/校园 SSO |
| R16 RBAC、隐私与删除 | 本人/编辑/审核/管理员、CSRF、导出/删除、日志脱敏 | `services/auth.ts`、`server/utils/api.ts`、`/api/account/*` | P0/P1 | 代码已实现；教师/客服私密读取不开放 |
| R17 数据模型、迁移与 seed | 内容、身份、实例、事件、快照、回执、手账、审计 | `packages/database/`、`scripts/db.ts` | P0 | 实际数据库与合成 seed；私有 SQLite 不提交 Git |
| R18 内容后台与发布回退 | 草稿→检查→审核→发布、不可变版本、资源门禁、审计、预算批次、seed预览、自愿反馈 | `pages/admin.vue`、`services/content.ts`、`services/batches.ts`、`services/feedback.ts`、对应/admin API及`/api/feedback` | P0 | 结构化包编辑、逐项批次结果、预算续跑、seed预览、显式反馈均已实现并通过服务/浏览器流程；图形编辑器属于P1 |
| R19 美术标准与制作记录 | 角色基准、表情参考编辑、场景安全区、许可 | `art/`、美术文档、`scripts/art/export.mjs` | P0 | 21次真实图像生成/参考编辑、逐张智能体视觉复核、实际运行截图已交付；未声称人工行业或法律审核 |
| R20 实际资产与版本绑定 | 12 立绘、3 头像、4 背景、hash、资源预算、不可覆盖版本 | `apps/web/public/art/manifest.json`、`checkAssets`、`useArt.ts` | P0 | 资源门禁阻止缺失/未知权利发布；最终数量体积见美术报告 |
| R21 品牌与五类界面 | 剧情、聊天、选择、手账、存读档；手机/桌面 | `BrandMark.vue`、`main.css`、玩家页面、运行截图 | P0 | 代码已实现；390×844 / 1440×900截图与交互检查单独记录 |
| R22 性能、动效、声音与无障碍 | 低流量、纯文字、减少动态、失败退化、焦点/44px/静音 | `preferences.ts`、`ArtImage.vue`、页面样式与浏览器测试 | P0/P1 | 首版可无声游玩；未测设备/网络指标不得写为已达标 |
| R23 自动测试、质量与对抗 | DSL/导入/XSS/提示注入/资源越界/权限/恢复 | `tests/`、Vitest、Playwright、lint/typecheck/build | P0 | 各类测试结果、最终数量与总门禁统一见验收记录；本表不复制易过期计数 |
| R24 部署、备份与运维 | Node/Nitro、HTTPS反代、SQLite持久卷、备份恢复、CI | `.env.example`、`scripts/db.ts`、运维与CI文档 | P0 | 未部署；生产代理/弱网与远程 libSQL 不冒称已验证 |
| R25 持续交付与用户/管理指南 | featureId、验收、commit/push/CI、README、ADR、API/用户手册 | `docs/delivery-log.md`、README 与集中管理文档 | P0 | 提交/远端确认由根任务维护；本地通过不能代替 push 成功 |

## 必测行为对照

| 原始必测项 | 实际证据位置 | 不可替代的进一步验证 |
|---|---|---|
| 三路线、帮助/拒绝/下班、换职责 | `tests/domain.test.ts` | 真实 UI 的选择可达 |
| 群聊/私聊/解释/手账隔离，NPC 不知未来 | 领域职责测试、`tests/backend.test.ts` | 真实 provider 提示隔离回归 |
| 重复/并发动作、响应丢失、崩溃 | 服务层测试 | 两个请求真正竞争与重启恢复 |
| 字节跨块、半行、坏帧、缺号、重复、缺 end、长中文消息快照 | `tests/protocol.test.ts`、`tests/backend-capacity.test.ts` | 生产代理和移动浏览器断线 |
| delta 不改状态、失败恢复、声称与完成分离 | FrameSchema 和协议测试、服务层 | UI 重连后 full snapshot 对齐 |
| 读档/分支、旧版本、游客认领 | 服务层测试、冻结实例领域测试 | 浏览器切换分支/账号 |
| 注入/非法 DSL/XSS/导入/路径/私密缓存 | 严格 schema、服务端 API、安全文本渲染、`tests/archive.test.ts` | 归档重新签 hash 仍不能伪造世界状态；不把 checksum 当签名 |
| 真实事务/删除/备份恢复 | SQLite 集成测试、`scripts/db.ts` | 从备份启动并查询数据，不能只检查文件存在 |
| 手机/桌面美术、焦点/安全区/静音 | 实际截图与视觉记录 | 200% 文字和软键盘必须单独检查 |
| 真实 AI 费用/延迟/质量 | 无密钥时为条件验证 | mock 无法证明模型自然度和隐私安全 |
| 批次重跑/预算/草稿隔离 | `tests/domain-pipeline.test.ts`、CLI 实跑 | 后台审核轨迹和权限 |
| 前提/角色/互斥/seed/安全包/旧局 | `tests/domain.test.ts` | 实际 occurrence 写入与回放 |
| 真实美术可加载、版本匹配、远端可追 | checkAssets、manifest、交付日志 | 只有模板/占位的项目不得标完成 |

## 验收证据与未完成项

上表每一项的“实际文件”用于定位实现，不自动代表已通过验收。最终运行命令、用例数量、浏览器场景、截图、资源检查及未覆盖环境统一维护在[验收记录](verification.md)，阶段提交与推送另见[交付日志](delivery-log.md)。可复现内容管线命令见[内容库说明](content-library.md)，归档边界见[个人归档说明](content-archive.md)，P1/P2 条目及资源前提见[路线图](roadmap.md)。

模拟候选的 token 数是字符估算，费用为 0；它们不能作为真实模型账单、岗位事实审核或教育效果证据。没有真实模型密钥、生产部署、行业审核或目标真机实测时，相关结论保持条件验证，不通过移动阶段名隐藏 P0 缺口。

