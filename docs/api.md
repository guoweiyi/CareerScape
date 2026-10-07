# P0 HTTP / JSONL 契约

实现文件为 `apps/web/server/api/**`，领域传输校验为 `packages/contracts/**`。全部私有接口 `Cache-Control: private, no-store`、`Vary: Cookie`。不可把这些路径加进 CDN 共享缓存。

## 身份与 CSRF

同源服务端 Session Cookie：`careerscape_session`，随机 256 位；数据库仅存 SHA-256 摘要；HttpOnly、SameSite=Lax，production 使用 Secure。所有写请求必须发送与 `APP_ORIGIN`（未设时当前请求 origin）一致的 Origin；已有身份还必须发送 `/api/me` 返回的 `x-csrf-token`。不存在浏览器可读的认证 bearer token。

| 路径 | 输入 / 返回 |
|---|---|
| GET `/api/me` | `{user:null或{id,username,isGuest,roles},csrfToken:null或string}` |
| POST `/api/guest` | 空对象；创建不可猜测游客身份，已有身份不替换 |
| POST `/api/auth/register` | `{username,password,claimGuest:boolean}`；返回 user、csrfToken、6 个一次性 recoveryCodes，仅当场显示 |
| POST `/api/auth/login` | `{username,password,claimGuest?:boolean}`；返回 user、csrfToken；明确勾选才能认领当前游客 |
| POST `/api/auth/recover` | `{username,recoveryCode,newPassword}`；消费一个恢复码、更换密码并撤销全部旧设备 |
| POST `/api/auth/logout` | 空对象；撤销当前服务端会话并清 Cookie |
| GET `/api/account/export` | 本人归档 `schemaVersion:'1.1'`、冻结包引用与 SHA-256 校验和；包含存档、分支、实例、事件、快照、手账、可选反馈；无凭据或密码哈希 |
| POST `/api/account/import` | 请求体为自己的完整 1.1 归档，最多 512,000 UTF-8 字节；返回 `{importedSessions,sessionIds,replayed}`。校验字段、校验和、冻结包与资源、引用和实际行动回放后，在当前身份下创建独立副本；不导入账号权限或回执 |
| DELETE `/api/account` | `{confirm:"DELETE"}`；级联删除数据并登记最少量删除指纹供备份恢复重放 |

用户名 3—32 位 ASCII 字母、数字或下划线；密码 12—128 字符。密码使用 Argon2id，19 MiB / 2 次 / 单并行。恢复码是高熵随机离线码，无邮件资质依赖；用户必须自行保存，全部丢失不提供绕过身份验证的找回入口。API 的密码/恢复码尝试受数据库限流，错误消息不输出请求体。

## 玩家接口

| 路径 | 契约 |
|---|---|
| GET `/api/catalog` | `{occupations:[{id,title,description,packId,packVersion,status:'playable'或'preparing',synthetic:true,assetManifestVersion}],provider:'mock'或'openai'}` |
| GET `/api/sessions` | `{sessions:[{id,title,branchId,revision,packId,packVersion,status,nodeId,createdAt,updatedAt}]}` |
| POST `/api/sessions` | `{packId:'qa-last-hour',seed?:string}` → SessionDTO；仅发布入口可创建 |
| GET `/api/sessions/:id` | 可选 `?branchId=` → SessionDTO；服务端校验账号和分支归属 |
| POST `/api/sessions/:id/action` | 下述 ActionInput → `application/x-ndjson` |
| GET `/api/sessions/:id/turn?clientActionId=` | `{status:'not_found'或'running'或'retryable'或'failed'或'committed',session?}` |
| POST `/api/sessions/:id/fork` | `{branchId,eventSeq}` → 新分支 SessionDTO，保留旧分支 |
| GET `/api/sessions/:id/journal?branchId=` | `{text,updatedAt}` |
| POST `/api/sessions/:id/journal` | `{text,branchId?}`；最多 10,000 字符；仅本人 |
| GET `/api/sessions/:id/history?branchId=&beforeEventSeq=` | 向前 12 个事件的 `{messages,hasMore,nextBeforeEventSeq}` |
| GET `/api/health` | 数据库只读存活查询；不泄漏路径、版本密钥或个人数据 |
| POST `/api/feedback` | `{consent:true,kind:'experience'或'content_issue'或'technical_issue'或'suggestion',text,sessionId?}`；1—2000字，选填旅程必须本人；返回id/createdAt，仅保存主动填写的反馈 |

```ts
type ActionInput = {
  clientActionId: string // 8—80 字符，一次用户意图一个稳定 ID
  expectedRevision: number
  branchId: string
  kind: 'choice' | 'message' | 'explain' | 'leave' | 'switch_role'
  choiceId?: string
  text?: string // 最多 2,000 字符
  channel: 'group' | 'private'
  recipientId?: 'lin' | 'zhou' | 'xu'
}
```

SessionDTO 的实际 TypeScript 类型导出于 `apps/web/server/services/game.ts`，前端只可 `import type`，不可导入该服务的运行时代码。DTO 包含 id/title/branchId/revision/eventSeq/status/packId/packVersion/assetManifestVersion/state/node/choices/messages/branches/instance/characters/createdAt/updatedAt/provider/hasMoreHistory。消息格式：`{id,eventSeq,speakerId,text,expression,channel,recipientId?,createdAt,sourceEventIds}`。分支格式：`{id,parentBranchId,forkEventSeq,revision,nodeId,label}`。

`currentNodeVisit={visitId,nodeId,eventSeq}` 用进入节点的真实事件标识访问实例，不能把 nodeId 当一次游玩的唯一访问。`lastIntent` 为最后一条已提交消息的可选候选：`{kind:'leave'|'help'|'choice'|'clarify'|'chat',choiceId?,confidence,confirmationLabel}`。只有高置信且用户再次确认才发送新动作；输入一句“我想下班”只生成待确认建议，世界状态保持不变。候选来自精确全文规则，不把含关键词、否定或注入文字硬套为行动。

快照最多带最近 60 条完整消息，消息数组序列化后的 UTF-8 大小不超过 100,000 字节；`hasMoreHistory` 按实际截取结果计算，历史接口与导出提供更早记录。玩家快照只传用于显示的节点、选项和人物字段，不传作者图后续边、选项效果/未来对白或完整人物目标。完整快照硬上限 220,000 字节，给 256,000 字节 JSONL 单帧上限留出封装余量；超限明确返回 `SNAPSHOT_TOO_LARGE`，不截断半条消息或伪报同步成功。每个 action 仅追加一个领域事件，事件中有实际消息列表、动作、效果、revision 和 state_after。eventSeq 在同一 session 内全局递增，revision 属于分支。长中文对话边界用例见 `tests/backend-capacity.test.ts`，实际执行结果见[验收记录](verification.md)。

JSONL 完整顺序为 `turn_started → tool_status → heartbeat（需要时）→ message_start/message_delta（已提交文本）→ turn_committed → stream_end`。每帧含 protocolVersion/frameId/streamId/streamSeq/turnId/sessionId/branchId/at/type/payload。当前 P0 不展示未经提交的模型 token；所有 delta 带 `provisional:false` 和 `committedRevision`。`turn_committed.session` 提供保存快照，解析器只校验其对象结构；当前页面在完整提交与结束帧校验通过后，通过有归属检查的 GET 会话接口更新权威状态，不直接信任任意快照对象。文字发送前已完成事务；断网不会撤销提交。

增量解析器默认限制单帧 256,000 字节、整流 2,000,000 字节与 4,096 帧。除 UTF-8、schema、归属、连续序号和重复帧校验外，还验证消息起始、消息修订、提交消息集合与唯一业务结果。请求取消会中止待执行的流读取，但不能撤销服务端已保存的动作。导入和传输预算均按 UTF-8 字节计算；导出可能大于网页导入上限，较大归档需受控迁移工具，详见[归档说明](content-archive.md)。

相同 `(sessionId,clientActionId)` 相同正文返回原回执，包含原始实际文本。异正文拒绝 `ACTION_BODY_CONFLICT`；revision 过期拒绝 `REVISION_CONFLICT`；正在生成返回 `TURN_RUNNING`，客户端查询 turn 后使用原 ID 重试。45 秒租约超过生成 25 秒超时，旧工作者在提交前再次校验租约与 revision。过期任务可重领，同一分支同时只准一个有效生成租约。流内失败为 `turn_failed + stream_end`，不是 HTTP 200 就等于保存成功。

## 后台接口

GET `/api/admin/feedback` 需要 editor/reviewer/admin，返回最近100条中明确同意的反馈 `{items:[{kind,text,createdAt}],limit:100}`，不返回账号标识、聊天、手账或旅程全文。反馈随账号删除，游客认领与本人导出使用既有归属机制。

SessionDTO 的 `prefetchAssetIds` 只包含当前第一个合法选择目标场景的最多两个已登记资源ID，不包含未来文本。客户端还有每轮400KB/每会话2MB上限，低流量/纯文字/saveData时禁用。

GET `/api/admin` 需要 editor/reviewer/admin 任一内容角色，返回内容版本、资源门禁、模型路由标识、必要统计和脱敏审计，不提供玩家私聊、手账或研究记录。审计项为 `{action,resourceId,metadata,createdAt}`，统一camelCase且metadata为已解析对象；原创合成包行业审核仍为pending，自动审核记录reviewerType=agent。

POST `/api/admin/content` 接收 `{action,packId,version,pack?,reason?,reviewerType?:'agent'|'human'}`；默认 reviewerType 为 agent，不能把自动检查伪报人工行业审核。`clone/save/check` 仅 editor，`approve` 仅 reviewer，`publish/rollback` 仅 admin。拥有 admin 不隐含其余两个角色；本地 bootstrap CLI 明确授予三项。

流程：克隆旧版本 → 编辑草稿 → 自动检查 → 内容审核 → 发布。正式行业发布要求 domainReviewStatus=verified；原创合成 demo 可保留 pending，但仍要求实际美术文件、许可、审核、数量和 hash 通过。草稿不得开局；已发布正文不可修改。回退只更改新开局入口，旧存档保持固定版本。

POST `/api/admin/roles` 为 `{userId,role:'editor'|'reviewer'|'admin',enabled:boolean}`，仅 admin。后台角色无法绕过玩家接口的 owner_id 检查。

GET `/api/admin/batches` 返回 `{provider:'mock',batches}`，内容三种角色可读；POST 同路径需要 editor，接收 `{action:'plan'|'generate'|'resume'|'validate',packId,version,batchId?,variant?,maxTokens?:0..50000,dryRun?:boolean}`，返回预算、游标、逐项候选与状态。非plan必须已有批次。它只使用明确的合成mock，无付费provider分支；CAS防并发覆盖，预算用尽暂停，续跑保留审核过的候选。POST `/api/admin/preview` 需要 editor，输入 `{packId,version,seed}`，返回 `{previewOnly:true,sourceStatus,instance,state,choices,assetGate,note}`；草稿预览不创建玩家存档，不改变发布状态。

普通 HTTP 错误使用 `{statusCode,statusMessage,message,data:{code}}`；解析错误是 400、归属隐藏 404、身份 401、权限和 CSRF 403、冲突 409、限流 429。未知内部错误仅返回通用文案，不输出 SQL、密钥或 prompt。
