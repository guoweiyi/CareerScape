import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Store, invariant, now } from '../packages/database'
import { AuthService } from '../apps/web/server/services/auth'
import { GalgameService } from '../apps/web/server/services/galgame'
import { ArchiveService } from '../apps/web/server/services/archive'
import { createGalgameProvider } from '../packages/agent/galgame'
import type { CareerId, GalgameMessage, GalgameSessionDTO } from '../packages/contracts/galgame'

// This command is a paid, real-provider check in an isolated in-memory database.
// It never enables the application or touches existing player saves.
process.env.GALGAME_ENABLED = '1'
const provider = createGalgameProvider()
if (!provider.available || provider.model.includes('test-fixture')) {
  console.error(
    JSON.stringify({
      status: 'refused',
      code: 'LIVE_CONFIG_REQUIRED',
      message: '真实验收需要所选供应商的服务器密钥、模型名和有效接口地址；未调用模型。',
    }),
  )
  process.exit(1)
}
const store = new Store(':memory:'),
  auth = new AuthService(store),
  game = new GalgameService(store, provider)
const results: {
  careerId: CareerId
  outcome: string
  revision: number
  modelCalls: number
  inputTokens: number | null
  outputTokens: number | null
}[] = []
const samples: {
  careerId: CareerId
  messages: Pick<GalgameMessage, 'eventSeq' | 'speakerId' | 'text' | 'channel'>[]
  artifacts: GalgameSessionDTO['artifacts']
  debrief: GalgameSessionDTO['debrief']
}[] = []
let currentCareer: CareerId | undefined, stage = 'seed'
const modelCalls = () => store.get<{ n: number }>('SELECT COUNT(*) n FROM galgame_model_attempts')!.n
function input(session: GalgameSessionDTO, kind: string, extra: Record<string, unknown> = {}) {
  return {
    clientActionId: kind === 'begin' ? session.beginActionId : crypto.randomUUID(),
    branchId: session.branchId,
    expectedRevision: session.revision,
    kind,
    channel: 'group',
    ...extra,
  }
}
try {
  game.content.seed()
  for (const careerId of ['qa', 'frontend', 'product'] as const) {
    currentCareer = careerId
    stage = 'begin'
    const userId = auth.guest().user.id
    let session = game.create(userId, {
      mode: 'galgame',
      careerId,
      player: {
        name: '小禾',
        identity: 'graduate',
        avatar: 'leaf',
        background: '正在通过模拟案例了解岗位协作。',
      },
      seed: 'live-quality-check-v1',
    })
    const begin = input(session, 'begin')
    session = (await game.act(userId, session.id, begin)).session
    const generatedCalls = modelCalls()
    const replay = await game.act(userId, session.id, begin)
    invariant(replay.replayed && modelCalls() === generatedCalls, 'LIVE_IDEMPOTENCY', 422, '重复行动发生了重复生成。')
    game.get(userId, session.id, session.branchId)
    game.history(userId, session.id, session.branchId)
    invariant(modelCalls() === generatedCalls, 'LIVE_READ', 422, '读取存档不应调用模型。')
    invariant(
      session.status === 'active' && session.choices.length >= 2,
      'LIVE_OPENING',
      422,
      '开场没有生成有效场景和选项。',
    )
    stage = 'private'
    session = (
      await game.act(
        userId,
        session.id,
        input(session, 'message', {
          channel: 'private',
          recipientId: 'zhou',
          text: '请只在这次私聊中说明你掌握的案例线索，并标记未验证事项。',
        }),
      )
    ).session
    invariant(
      session.messages
        .filter((message) => message.eventSeq === session.eventSeq)
        .every((message) => message.channel === 'private' && message.recipientId === 'zhou'),
      'LIVE_PRIVACY',
      422,
      '私聊回复范围不正确。',
    )
    stage = 'act'
    session = (
      await game.act(
        userId,
        session.id,
        input(session, 'act', {
          text: '我先整理已经获得的案例材料，把观察和假设分开，向导师确认产物需要保留哪些证据；不进行发布或承诺。',
        }),
      )
    ).session
    const fields: Record<CareerId, string[]> = {
      qa: [
        '虚构测试环境：Chrome、test-v0.8构建、测试账号test-xiaohe、弱网；不接触生产。',
        '根据给定案例记录连续点击报名两次，整理两条记录；这只是案例复现步骤，尚未实际运行。',
        '按给定需求，同一账号在同一活动应仅有一条有效报名；需产品负责人确认异常提示。',
        '给定材料描述两条重复记录；未补造日志或声称完成真实复现。',
        '可能重复占用名额。建议交由导师核对证据，开发修复后另行验证正常、连续点击和弱网；新人不批准上线。',
      ],
      frontend: [
        '按虚构案例，重复报名返回409却显示成功，错误后焦点与提示需要复核；不声称已实际调试。',
        '对照已给定的契约与代码线索分析状态清理和错误分支；未获得的代码保持待确认。',
        '拟对409和网络错误区分用户提示，结束后清理提交状态，设置可读的错误消息与焦点；请求同事审阅。',
        '计划检查成功、409、断网、键盘焦点及屏幕阅读器播报；这里只提交审阅方案，没有运行测试或部署。',
      ],
      product: [
        '按虚构案例，核心目标是可靠确认报名状态和有效名额，减少不确定；不是新增营销或导出功能。',
        '在剩余两小时内聚焦重复报名与确认提示；导出需求需至少两天，记录为后续待办，需负责人确认。',
        '先处理影响有效名额和信任的问题，说明风险依据和未确认信息；不替负责人承诺排期或发布。',
        '建议同账号同活动仅保留一条有效报名、重复操作有清晰提示；产品负责人确认边界后由测试验证，不声称已通过验收。',
      ],
    }
    stage = 'artifact'
    session = (
      await game.act(
        userId,
        session.id,
        input(session, 'submit_artifact', {
          artifact: {
            id: crypto.randomUUID(),
            taskId: session.tasks[0]!.id,
            fields: Object.fromEntries(
              session.artifactFields.map((field, i) => [field.id, fields[careerId][i]!]),
            ),
          },
        }),
      )
    ).session
    invariant(session.artifacts.at(-1)?.review, 'LIVE_REVIEW', 422, '导师没有审阅实际产物。')
    stage = 'leave'
    if (session.status !== 'ended')
      session = (await game.act(userId, session.id, input(session, 'leave'))).session
    stage = 'debrief'
    session = (await game.act(userId, session.id, input(session, 'debrief'))).session
    invariant(
      session.debrief?.observations.length && session.debrief.interviewPractice.includes('不是实际任职经历'),
      'LIVE_DEBRIEF',
      422,
      '就业复盘未保留模拟经历标识。',
    )
    stage = 'fork-and-archive'
    const beforeForkCalls = modelCalls()
    const fork = game.fork(userId, session.id, { branchId: session.branchId, eventSeq: 2 })
    invariant(fork.messages.every(message => message.eventSeq <= 2) && modelCalls() === beforeForkCalls, 'LIVE_FORK', 422, '回溯没有保留原前缀或触发了生成。')
    const imported = new ArchiveService(store).import(auth.guest().user.id, auth.export(userId, session.id))
    invariant(imported.importedSessions === 1, 'LIVE_ARCHIVE', 422, '真实生成结果未通过存档回放校验。')
    const usage = store.get<{ n: number; input: number | null; output: number | null }>(
      'SELECT COUNT(*) n,CASE WHEN COUNT(input_tokens)=COUNT(*) THEN SUM(input_tokens) END input,CASE WHEN COUNT(output_tokens)=COUNT(*) THEN SUM(output_tokens) END output FROM galgame_model_attempts a JOIN turns t ON t.id=a.turn_id WHERE t.session_id=?',
      session.id,
    )!
    results.push({
      careerId,
      outcome: session.outcome!,
      revision: session.revision,
      modelCalls: usage.n,
      inputTokens: usage.input,
      outputTokens: usage.output,
    })
    // Only the script's synthetic case transcript, never prompts or live player data.
    samples.push({
      careerId,
      messages: session.messages.map(({ eventSeq, speakerId, text, channel }) => ({
        eventSeq,
        speakerId,
        text,
        channel,
      })),
      artifacts: session.artifacts,
      debrief: session.debrief,
    })
    console.log(JSON.stringify({ careerId, status: 'passed', modelCalls: usage.n }))
  }
  mkdirSync('test-results', { recursive: true })
  const report = {
    checkedAt: now(),
    status: 'passed',
    provider: provider.name,
    model: provider.model,
    cases: results,
    samples,
    humanReviewRequired: '还需人工阅读真实对白，核验岗位准确性、连续性和权限表述；此报告只证明结构与流程。',
  }
  writeFileSync(resolve('test-results/galgame-live.json'), JSON.stringify(report, null, 2))
  console.log('真实模型链路通过；报告：test-results/galgame-live.json。应用开关未改变。')
} catch (error) {
  const failure = error as { code?: string }
  mkdirSync('test-results', { recursive: true })
  writeFileSync(resolve('test-results/galgame-live.json'), JSON.stringify({
    checkedAt: now(), status: 'failed', provider: provider.name, model: provider.model,
    careerId: currentCareer, stage, code: failure.code || 'LIVE_SMOKE_FAILED', cases: results, samples,
    calls: store.all('SELECT model,role,status,input_tokens,output_tokens,latency_ms,failure_code FROM galgame_model_attempts'),
  }, null, 2))
  console.error(
    JSON.stringify({
      status: 'failed',
      code: failure.code || 'LIVE_SMOKE_FAILED',
      careerId: currentCareer,
      stage,
      completedCareers: results.map((result) => result.careerId),
    }),
  )
  process.exitCode = 1
} finally {
  store.close()
}
