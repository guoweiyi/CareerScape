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
| GET `/api/account/export` | 本人完整存档、分支、实例、事件、快照、手账、可选反馈；无凭据或密码哈希 |
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

快照只带最近 60 条消息以控制 JSONL 帧体积；历史接口与导出提供更早记录。每个 action 仅追加一个领域事件，事件中有实际消息列表、动作、效果、revision 和 state_after。eventSeq 在同一 session 内全局递增，revision 属于分支。

JSONL 完整顺序为 `turn_started → tool_status → heartbeat（需要时）→ message_start/message_delta（已提交文本）→ turn_committed → stream_end`。每帧含 protocolVersion/frameId/streamId/streamSeq/turnId/sessionId/branchId/at/type/payload。当前 P0 不展示未经提交的模型 token；所有 delta 带 `provisional:false` 和 `committedRevision`，依旧只有 `turn_committed.session` 能整体更新客户端权威状态。发送前已完成事务；断网不会撤销提交。

相同 `(sessionId,clientActionId)` 相同正文返回原回执，包含原始实际文本。异正文拒绝 `ACTION_BODY_CONFLICT`；revision 过期拒绝 `REVISION_CONFLICT`；正在生成返回 `TURN_RUNNING`，客户端查询 turn 后使用原 ID 重试。45 秒租约超过生成 25 秒超时，旧工作者在提交前再次校验租约与 revision。过期任务可重领，同一分支同时只准一个有效生成租约。流内失败为 `turn_failed + stream_end`，不是 HTTP 200 就等于保存成功。

## 后台接口

GET `/api/admin` 需要 editor/reviewer/admin 任一内容角色，返回内容版本、资源门禁、模型路由标识、必要统计和脱敏审计，不提供玩家私聊、手账或研究记录。

POST `/api/admin/content` 接收 `{action,packId,version,pack?,reason?,reviewerType?:'agent'|'human'}`；默认 reviewerType 为 agent，不能把自动检查伪报人工行业审核。`clone/save/check` 仅 editor，`approve` 仅 reviewer，`publish/rollback` 仅 admin。拥有 admin 不隐含其余两个角色；本地 bootstrap CLI 明确授予三项。

流程：克隆旧版本 → 编辑草稿 → 自动检查 → 内容审核 → 发布。正式行业发布要求 domainReviewStatus=verified；原创合成 demo 可保留 pending，但仍要求实际美术文件、许可、审核、数量和 hash 通过。草稿不得开局；已发布正文不可修改。回退只更改新开局入口，旧存档保持固定版本。

POST `/api/admin/roles` 为 `{userId,role:'editor'|'reviewer'|'admin',enabled:boolean}`，仅 admin。后台角色无法绕过玩家接口的 owner_id 检查。

普通 HTTP 错误使用 `{statusCode,statusMessage,message,data:{code}}`；解析错误是 400、归属隐藏 404、身份 401、权限和 CSRF 403、冲突 409、限流 429。未知内部错误仅返回通用文案，不输出 SQL、密钥或 prompt。
