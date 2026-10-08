# 本人结局回顾

`GET /api/account/endings` 使用现有 Session Cookie 身份，未进入游客模式或未登录时返回 401。响应为私有且不缓存，不接受目标账号参数，内容管理员也只能读取自己的记录。

返回类型导出于 `apps/web/server/services/endings.ts`：

```ts
type EndingsDTO = {
  packs: {
    packId: string
    title: string
    totalEndings: number
    unlocked: {
      endingId: string
      title: string
      summary: string
      firstCompletedAt: string
      sessionId: string
      branchId: string
      packVersion: number
    }[]
  }[]
}
```

只展示本人已有会话的内容包；空账号返回 `{ packs: [] }`。同一 `packId + endingId` 合并为一项，不返回完成次数、排名或职业适配比例。`totalEndings` 为本人各冻结版本的结局 ID 并集数量；未解锁结局不返回 ID、标题或文本。UI 可用总数减已解锁项数展示匿名锁定项。

解锁依据是当前 `sessions.owner_id` 下所有分支的已提交 `event_logs`：公开 `choice` 或 `leave` 事件的 `state_after` 必须指向该会话冻结包中匹配 `endingId` 的结局节点。只存在分支状态、未提交回合、客户端完成声明，或结局后的聊天/解释都不能新增解锁。标题和摘要来自冻结节点，摘要取首条旁白（缺少旁白则取该节点说明），最多 240 个 Unicode 字符。不会读取事件消息正文、私聊或手账。

`firstCompletedAt` 是这个结局最早的终局事件时间；回看定位取最近的终局事件对应的本人会话、分支和实际内容版本。相同时间以事件序号和 ID 稳定排序。回看使用 `/play/{sessionId}?branchId={branchId}`，仍由现有会话接口检查归属。回溯创建新分支不会抹除原分支的完成记录；新分支尚未完成时也不会解锁未来结局。

此功能是只读查询，不新增表或计数。认领游客、受校验的存档导入和账号删除直接通过既有归属与级联删除生效。导入保留原事件完成时间，使用重建后的本人会话和分支 ID；不会授予源账号的访问权限。

如果同一旅程的另一条路线仍有未确认操作，回看链接优先保持指定的分支。页面会提示“前往原路线核对”，点击后才恢复原操作；核对完成前禁止切分支和回溯，保留同一个动作编号。待确认动作以有大小与期限限制的纯 JSON 快照存入 IndexedDB，避免 Vue 响应式对象无法结构化克隆而丢失。旧加载、历史与手账响应在切分支后失效。

本轮真实浏览器测试模拟服务端提交后响应及查询同时丢失，核对 IndexedDB 中保存的原动作编号，再离开页面、回看旧结局并显式恢复原路线。9 项 SQLite 服务测试验证三结局、合并、冻结版本、归属隔离、认领、导入和删除，执行汇总见[验收记录](verification.md)。
