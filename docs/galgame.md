# AI 职业故事：实现、研究与验收

新增 `/galgame` 入口，在现有 Nuxt/Vue 应用中选择测试、前端或产品岗位，设置名字、实习生/应届新人/转行身份、人物标记和背景。玩家进入虚构工作日，AI 现场生成场景、事件、行动选项和同事回应；可自由行动、私聊、整理资料、提交岗位产物、回溯，并在结束后按实际记录生成就业复盘。

## 当前项目分析与复用

原项目的核心是版本冻结的 QA 作者图，运行时按 seed 受约束组局，模型负责角色表达。Nuxt 4.6/Vue 3.5 承载页面，Pinia 保存阅读偏好；Nitro 的 Cookie 身份、Origin/CSRF 校验和 SQLite 单写事务保护实际存档。事件日志、分支前缀、快照、动作租约和回执已经支持断线恢复与回溯。原有美术的逻辑 ID、哈希清单和许可检查也可以直接复用。

| 原有能力                                                          | 新模式的复用方式                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 登录/游客/注册认领/恢复码/账号删除                                | 保留原接口，所有新数据通过会话归属及外键隔离、清理                                     |
| `/api/catalog`                                                    | 保留旧目录，增加 `galgame` 岗位与身份目录；不暴露服务器密钥或模型地址                  |
| `/api/sessions` 和 `[id]` 的读取/action/turn/history/fork/journal | 复用路由，按数据库中的 `mode` 分派；请求方不能切换已有会话模式                         |
| 租约、并发检查、幂等回执、事件序号                                | 提取到 `SessionRepository`，两种模式共用；新模式回执固定历史事件，重试不重新生成       |
| 存档和结局回顾                                                    | 保留 1.1 读取，增加 1.2 混合导入；导入先逐回合验证，再整体写入；结局仅来源于已提交事件 |
| ArtImage、既有 19 项逻辑美术、低流量/纯文字/减少动画              | 新 Vue 舞台直接使用；运行时不生图、不播音频                                            |
| IndexedDB 草稿、Pinia 偏好                                        | 草稿按用户、会话和路线隔离；仅保存待确认动作、产物草稿和私人手账，权威状态在服务器     |

新模式不套用旧 `WorldState`、固定事件池或 QA 作者节点。`packages/contracts/galgame.ts` 定义独立的有界场景、产物、资料、角色记忆和复盘协议。`packages/narrative/galgame.ts` 纯函数验证候选效果；`GalgameService` 组织真实调用与事务提交；前端只渲染经校验的 DTO。旧模式的 mock 和冻结路线仍按原规则工作。

数据库增加 `0002_galgame.sql`：原有 packs/sessions 的模式默认 `story`，新增职业实例、每日额度和模型调用记录。启动按 migration ledger 顺序执行一次；迁移与备份 CLI 报告版本为 0002。未重建或覆盖现有用户数据库。

## 外部引擎研究

六个仓库已克隆到工作区外的 `D:\image\research\careerscape-galgame-engines`。它们没有放入当前仓库、添加子模块或被当前 Git 跟踪。以下版本是本次实际研究的固定提交；没有复制第三方源码、剧本、美术或音频。

| 引擎及研究版本                                                                                                                 | 技术与许可                                                                   | 借鉴和取舍                                                               |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Narrat](https://github.com/liana-p/narrat-engine/tree/5ab42d5fcd798011770093e5148baffde2cbef6f) · `5ab42d5`                   | Vue 3、Pinia、本地叙事 VM；MIT                                               | 阅读推进、选择与状态存档的分离；它的本地 VM 不替换本项目服务器事件和权限 |
| [QuaEngine](https://github.com/QuaDevTeam/QuaEngine/tree/a17f6a6fe15a42716653b1c78cd01f2fddb28239) · `a17f6a6`                 | TS 核心、Vue 渲染适配；核心/Vue Apache-2.0，编辑器 MPL-2.0，示例另有权利限制 | 引擎状态向只读舞台投影；不引入编辑器或示例素材                           |
| [Galgame-SFW](https://github.com/chenpipi0807/Galgame-SFW/tree/5c8aa0915ceb38360874e3dd2b987a08659835ff) · `5c8aa09`           | Vue 3、FastAPI、SQLite、AI lore/记忆；MIT 加 Commons Clause 限售条件         | 角色上下文与场景生成的分工；本项目自行实现权限和事务，不复制其代码       |
| [VisualNovelCreator](https://github.com/yami2200/visualnovelcreator/tree/a935b9227fbcd866dbc1ae46a1234a8c9054a592) · `a935b92` | Vue 2、Electron、MIT；提交较旧                                               | 素材、人物、对白的舞台布局；不引入桌面运行时                             |
| [WebGAL](https://github.com/OpenWebGAL/WebGAL/tree/15173bc21339a65da34b78463fca8a304e4d503a) · `15173bc`                       | **React**，MPL-2.0                                                           | 借鉴舞台、对白、菜单和阅读体验；它不是 Vue 引擎                          |
| [WebGAL Terre](https://github.com/OpenWebGAL/WebGAL_Terre/tree/e319a4d6646a9b8b2e30de659bc74777395142d7) · `e319a4d`           | **React** 编辑器，MPL-2.0                                                    | 观察资源和场景管理；本轮不移植编辑器                                     |

实现采用自己的 Vue 舞台，以免同时维护本地脚本引擎状态与服务器存档。对白支持逐字、整句、下一句和自动读对白；自动播放不调用行动接口，页面隐藏、路线变化或卸载会暂停。

## 岗位依据与实际工作边界

岗位资料冻结在 `packages/content/galgame.ts`，保留 URL、出版方、核验日期 2026-10-09、适用范围与原创摘要：

- 测试：[O*NET Software Quality Assurance Analysts and Testers](https://www.onetonline.org/link/summary/15-1253.00)，用于理解测试任务；美国职业资料不直接用于中国薪资或招聘条件。
- 前端：[MDN Curriculum](https://developer.mozilla.org/en-US/curriculum/)，用于前端实践、可访问性和验证流程。
- 产品：[Atlassian Product Manager](https://www.atlassian.com/agile/product-management/product-manager)，用于目标、范围、优先级及协作边界。

三个案例都围绕虚构校园报名工具。测试岗位提交环境、步骤、预期、观察和风险；前端提交问题、分析、方案和验证计划；产品提交目标、范围、优先级和验收条件。流程与资料有出处，具体公司、账号、需求、接口和线索明确标记为虚构。新人可以提方案、请求复核和交接，不能批准发布、运行生产操作或承诺录用。代码文本只作审阅，不执行；导师的接受仅表示 **AI 模拟审阅**。

NPC 仅收到自己的已知材料、收到的实际公开/私聊记录及自己的有界记忆。私聊不直接改变公开任务，其他 NPC 不收到这段私聊；玩家可以明确分享已获得的资料。职业说明不改变世界状态。私人手账不进入模型上下文。资料 ID 和权限效果由规则校验，正文的岗位准确性与表述仍需真实模型验收和人工阅读；`domainReviewStatus` 保持 `pending`。

复盘观察必须引用本路线实际行动的事件序号、资料来源和已提交产物；没有产物不能伪造完成。面试表达始终加“模拟职业项目练习（不是实际任职经历）”标识，不生成适配分数、任职证明或录用结论。

## 配置真实模型

服务器环境配置以下项目，密钥不进入前端或 Git：

```dotenv
AI_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=在服务器环境中设置
GOOGLE_MODEL=gemini-3.8-flash
GOOGLE_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GALGAME_ENABLED=0
GALGAME_DAILY_TURNS=30
GALGAME_TIMEOUT_MS=60000
GALGAME_MAX_OUTPUT_TOKENS=2000
```

使用 Vercel `@ai-sdk/google` 原生适配器，不需要 Python 或 Google 官方 SDK。`GOOGLE_BASE_URL` 可以设置为所授权的兼容 Gemini 服务；根地址自动追加 `/v1beta`，已经带路径的地址保持不变。Google 请求使用 `x-goog-api-key` 和 `models/...:generateContent`，不会走 Chat Completions 或 Vercel Gateway。Gemini 3 Flash 使用 `thinkingLevel=minimal`；完整 JSON schema 同时写入提示，返回结果仍由 Zod 与职业规则校验，原生结构化输出的供应商支持并不替代这些校验。

旧剧情和新模式共用 `AI_PROVIDER=google` 配置。保留 `AI_PROVIDER=openai` 与 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL` 的已有兼容接口；历史存档继续可读。`GALGAME_ENABLED=0` 时入口可查看，开始按钮关闭。旧 `AI_PROVIDER=mock` 不会让新模式使用 mock。`pnpm dev` 和 `pnpm preview` 显式读取根目录 `.env`，环境变量优先；容器由 Compose 注入配置。凭据文件被 Git 忽略。

先执行 `pnpm galgame:smoke`。此命令只在隔离的内存数据库中调用真实模型，验证三岗位的开场、私聊、行动、实际产物复核、复盘及导入回放，可能产生模型费用。常规约 33 次模型调用，格式修复会增加，整体硬上限 60 次。报告保存在 Git 忽略的 `test-results/galgame-live.json`，包含脚本合成案例的实际对白、产物与复盘供人工阅读，不记录密钥或完整模型上下文。若配置缺失会明确拒绝且不调用模型。还需人工确认对白连续性、资料与权限表述，再把应用的 `GALGAME_ENABLED` 设为 `1` 并重启服务。smoke 不修改应用开关，不迁移或修改现有玩家数据库。浏览器测试会重新创建 test-results，真实验收后应先保存报告副本。

每个回合通常是导演一次、1–2 位 NPC 各一次，私聊/说明/复盘通常一次；最多一次格式修复，总计不超过 4 次。总超时上限 60 秒，不自动重试供应商请求。每次默认最多输出 2000 token，供应商实际报告的用量与耗时入库，未知用量为 null。每日每身份默认 30 个生成回合，**失败调用也计额度**，幂等重放不计额度；结束动作不调用模型。每日额度按 UTC 日期重置。每局最多 50 条路线，每路线 60 个生成/交互回合，允许额外结束及一次复盘；这不是抵抗反复新建游客的全局费用限流，应配合运营层访问控制和供应商预算。

## 故障与存档

回合顺序是“取得租约 → 候选 AI 场景 → 隔离角色回复 → 校验 → 原子保存 → 展示”。上游异常、超时、缺少产物、未知资料、越权审阅或不符合结构时，场景、分钟、产物与成功回执均不提交。失败调用记录与额度仍保留。断线后按原 `clientActionId` 查询/重试；按钮“查询后更换行动”会先确认没有运行中的原动作。

首次创建只保存职业和身份，开场使用稳定编号单独生成。GET、刷新、历史分页和回溯不重新生成过去对白。回溯复制真实前缀和冻结人物设定，保留独立手账；从开场之前的路线可重新开始。

含 AI 职业故事的导出使用 1.2，纯旧故事仍为 1.1；导入兼容两者。账号导出包含两种模式，存档页可单局导出。文件最大 16 MiB，超大总归档提示按局导出。导入只验证保存的生成结果与规则、版本和关系，不调用模型、不授予账号角色，也不证明导入对白来自真实供应商。原文件和原存档不会被覆盖。

## 验证范围

单元/集成测试涵盖三岗位产物流程、DTO 隐私、NPC 上下文、私聊、说明状态不变、幂等、租约、失败回滚、格式修复预算、每日额度、混合归档、篡改拒绝、旧库增量迁移和账号删除。HTTP 测试通过显式本地模型 fixture 验证 AI SDK 的 Google 原生与 OpenAI 兼容协议、鉴权、工具结果与思考签名续传、异常、截断和超时。浏览器测试通过同一个实际 HTTP 协议覆盖入口、身份选择、阅读、产物、复盘、刷新、失败重试、私聊、手账及回溯。

测试 fixture 仅位于 `tests/fixtures`，不会被应用导入，不是产品的 fallback。自动化测试通过不代表真实模型质量通过。Google 接入的真实验收和最新门禁结果见 `docs/verification.md`；实际报告保存在忽略目录，不应把测试 fixture 结果当作真实模型结果。未部署；真机 WebView、岗位人工审核和模型语义质量仍需对应环境。
