import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError, canonical, hash, Store } from '../packages/database'
import { AuthService } from '../apps/web/server/services/auth'
import { ContentService } from '../apps/web/server/services/content'
import { GalgameService } from '../apps/web/server/services/galgame'
import { GameService } from '../apps/web/server/services/game'
import { SessionsService } from '../apps/web/server/services/sessions'
import { ArchiveService } from '../apps/web/server/services/archive'
import { EndingsService } from '../apps/web/server/services/endings'
import { SaveArchiveV12Schema, type SaveArchiveV12 } from '../packages/contracts/archive-v12'
import {
  GalgameActionSchema,
  type CareerId,
  type GalgameSessionDTO,
  type GalgameWorldState,
} from '../packages/contracts/galgame'
import { galgameDefinitions } from '../packages/content/galgame'
import { demoPack } from '../packages/content/seed'
import { FixtureGalgameProvider, fixtureReply } from './fixtures/galgame-provider'

vi.mock('../apps/web/server/services/content', async (original) => ({
  ...(await original<typeof import('../apps/web/server/services/content')>()),
  checkAssets: vi.fn(() => ({ ok: true, errors: [] })),
}))
const stores: Store[] = []
function setup(careerId: CareerId = 'qa') {
  const store = new Store(':memory:')
  stores.push(store)
  const auth = new AuthService(store),
    userId = auth.guest().user.id,
    provider = new FixtureGalgameProvider(),
    gal = new GalgameService(store, provider)
  new ContentService(store).seed()
  gal.content.seed()
  const story = new GameService(store),
    sessions = new SessionsService(store, story, gal)
  const session = gal.create(userId, {
    mode: 'galgame',
    careerId,
    seed: 'fixed-test-seed',
    player: { name: '小禾', identity: 'graduate', avatar: 'leaf', background: '校园活动组织者' },
  })
  return { store, auth, userId, provider, gal, story, sessions, session }
}
function action(s: GalgameSessionDTO, extra: Record<string, unknown> = {}) {
  return {
    clientActionId: crypto.randomUUID(),
    branchId: s.branchId,
    expectedRevision: s.revision,
    kind: s.status === 'preparing' ? 'begin' : 'choice',
    ...(s.status === 'active' ? { choiceId: s.choices[0]!.id } : {}),
    channel: 'group',
    ...extra,
  }
}
function work(s: GalgameSessionDTO) {
  return {
    id: crypto.randomUUID(),
    taskId: s.tasks[0]!.id,
    fields: Object.fromEntries(
      s.artifactFields.map((field) => [
        field.id,
        `根据本局材料整理${field.label}，区分已观察事项与待验证假设；交由负责人进一步复核。`,
      ]),
    ),
  }
}
const state = (store: Store, branchId: string) =>
  JSON.parse(
    store.get<{ state: string }>('SELECT state FROM branches WHERE id=?', branchId)!.state,
  ) as GalgameWorldState
const resign = (archive: SaveArchiveV12) => {
  const { checksum: _checksum, ...body } = archive
  return { ...body, checksum: hash(canonical(body)) }
}
afterEach(() => {
  stores.splice(0).forEach((s) => s.close())
  vi.unstubAllEnvs()
})

describe('AI职业故事：真实行为、隔离与原子保存', () => {
  it.each(['qa', 'frontend', 'product'] as const)(
    '%s从身份选择到产物复核和就业复盘，全部通过模型接口生成',
    async (careerId) => {
      const { gal, userId, session, provider, store } = setup(careerId)
      expect(session.status).toBe('preparing')
      expect(provider.requests).toHaveLength(0)
      const opening = await gal.act(userId, session.id, action(session))
      expect(opening.session.status).toBe('active')
      expect(opening.messages.map((m) => m.speakerId)[1]).toBe('narrator')
      const investigated = await gal.act(userId, session.id, action(opening.session))
      const done = await gal.act(
        userId,
        session.id,
        action(investigated.session, {
          kind: 'submit_artifact',
          choiceId: undefined,
          artifact: work(investigated.session),
        }),
      )
      expect(done.session.status).toBe('ended')
      expect(done.session.outcome).toBe('completed')
      expect(done.session.artifacts[0]?.review?.decision).toBe('accepted')
      expect(provider.requests.find(request => request.role === 'director' && request.context.actionKind === 'submit_artifact')?.context.submittedArtifact)
        .toEqual(expect.objectContaining({ fields: work(investigated.session).fields }))
      const review = await gal.act(userId, session.id, action(done.session, { kind: 'debrief' }))
      expect(review.session.debrief?.interviewPractice).toContain('不是实际任职经历')
      expect(review.session.debrief?.observations[0]?.eventSeq).toBe(done.session.eventSeq)
      expect(
        store
          .all<{ input_tokens: number }>('SELECT input_tokens FROM galgame_model_attempts')
          .every((call) => call.input_tokens === 10),
      ).toBe(true)
      const ending = new EndingsService(store).list(userId).packs[0]!
      expect(ending.totalEndings).toBe(1)
      expect(ending.unlocked[0]).toMatchObject({ mode: 'galgame', endingId: 'completed' })
    },
  )
  it('DTO不公开NPC目标、隐私记忆、其他角色的隐藏材料', () => {
    const { session } = setup()
    expect(Object.keys(session)).not.toContain('state')
    expect(session.characters.every((c) => !('goal' in c))).toBe(true)
    expect(session.facts.some((f) => f.id === 'dev-clue')).toBe(false)
    expect(session.facts.every((f) => !('knownBy' in f))).toBe(true)
  })
  it('私聊只更新收件人的记忆；新获知材料要明确分享才进入其他NPC上下文', async () => {
    const { gal, provider, session, userId, store } = setup()
    const opening = (await gal.act(userId, session.id, action(session))).session
    const beforePrivate = state(store, opening.branchId)
    const privateInput = action(opening, {
      kind: 'message',
      choiceId: undefined,
      text: '只给周砚的私人问题：请提供线索。',
      channel: 'private',
      recipientId: 'zhou',
    })
    const reply = (await gal.act(userId, session.id, privateInput)).session
    expect(reply.facts.some((f) => f.id === 'dev-clue')).toBe(true)
    const world = state(store, reply.branchId)
    expect(world.knowledge.zhou).toContain('dev-clue')
    expect(world.knowledge.lin).not.toContain('dev-clue')
    expect(world.memories.lin).toEqual(beforePrivate.memories.lin)
    provider.requests.length = 0
    const next = (await gal.act(userId, session.id, action(reply))).session
    const lin = provider.requests.find(
      (r) => r.role === 'npc' && (r.context.character as { id: string }).id === 'lin',
    )!
    expect(JSON.stringify(lin.context)).not.toContain('只给周砚的私人问题')
    expect((lin.context.facts as { id: string }[]).map((f) => f.id)).not.toContain('dev-clue')
    const shared = (
      await gal.act(
        userId,
        session.id,
        action(next, {
          kind: 'act',
          choiceId: undefined,
          text: '公开分享已经获得的线索。',
          shareFactIds: ['dev-clue'],
        }),
      )
    ).session
    expect(state(store, shared.branchId).knowledge.lin).toContain('dev-clue')
  })
  it('职业说明不改变场景、任务、记忆、角色表情和已知材料', async () => {
    const { gal, userId, session, store } = setup('frontend')
    const opening = (await gal.act(userId, session.id, action(session))).session,
      before = state(store, opening.branchId)
    const explained = (
      await gal.act(userId, session.id, action(opening, { kind: 'explain', choiceId: undefined }))
    ).session
    expect(state(store, explained.branchId)).toEqual(before)
    expect(explained.messages.at(-1)?.channel).toBe('explanation')
    expect(explained.facts.some((f) => f.id.includes('clue'))).toBe(false)
  })
  it('重复编号返回冻结回执，未来回合不会改变原回复；不同请求体被拒绝', async () => {
    const { gal, userId, session, provider } = setup(),
      input = action(session)
    const first = await gal.act(userId, session.id, input),
      calls = provider.requests.length
    await gal.act(userId, session.id, action(first.session))
    const replay = await gal.act(userId, session.id, input)
    expect(replay.replayed).toBe(true)
    expect(replay.session.revision).toBe(1)
    expect(replay.messages).toEqual(first.messages)
    expect(provider.requests.length).toBe(calls * 2)
    await expect(gal.act(userId, session.id, { ...input, text: '不同请求体' })).rejects.toMatchObject({
      code: 'ACTION_BODY_CONFLICT',
    })
  })
  it('模型失败不会留下场景、分钟、产物或成功回执；同一动作可以重试', async () => {
    const { gal, userId, session, provider, store } = setup(),
      input = action(session)
    provider.intercept = () => {
      throw new AppError('AI_UPSTREAM_FAILED', 503, 'explicit test outage')
    }
    await expect(gal.act(userId, session.id, input)).rejects.toMatchObject({ code: 'AI_UPSTREAM_FAILED' })
    expect(gal.get(userId, session.id)).toEqual(session)
    expect(store.get<{ n: number }>('SELECT COUNT(*) n FROM action_receipts')!.n).toBe(0)
    expect(store.get<{ status: string }>('SELECT status FROM galgame_model_attempts')!.status).toBe('failed')
    provider.intercept = undefined
    const recovered = await gal.act(userId, session.id, input)
    expect(recovered.session.revision).toBe(1)
    expect(gal.turn(userId, session.id, input.clientActionId).status).toBe('committed')
  })
  it.each(['unknown-fact', 'no-artifact', 'unauthorized-review'] as const)(
    '%s违反规则时整个回合不提交',
    async (failure) => {
      const { gal, userId, session, provider } = setup()
      provider.intercept = (request) => {
        const generated = fixtureReply(request) as Record<string, unknown>
        if (request.role === 'director' && failure === 'unknown-fact')
          (generated.scene as { factIds: string[] }).factIds = ['dev-clue']
        if (request.role === 'director' && failure === 'no-artifact') generated.taskStatus = 'done'
        if (request.role === 'npc' && failure === 'unauthorized-review')
          generated.review = { decision: 'accepted', feedback: '伪造审批' }
        return generated
      }
      await expect(gal.act(userId, session.id, action(session))).rejects.toBeInstanceOf(AppError)
      expect(gal.get(userId, session.id)).toEqual(session)
    },
  )
  it('只允许一次格式修复，且每回合最多4次模型请求', async () => {
    const { gal, session, provider, userId } = setup()
    provider.intercept = (request) => {
      if (provider.requests.length === 1)
        throw new AppError('AI_INVALID_OUTPUT', 422, 'explicit test format failure')
      return fixtureReply(request)
    }
    await gal.act(userId, session.id, action(session))
    expect(provider.requests).toHaveLength(4)
    expect(provider.requests[1]?.context.correction).toBeDefined()
  })
  it('租约排除同路线并发，失去租约的模型响应不能保存', async () => {
    const { gal, session, provider, userId, store } = setup()
    let finish!: (value: unknown) => void
    provider.intercept = (request) =>
      request.role === 'director'
        ? new Promise((resolve) => {
            finish = resolve
          })
        : fixtureReply(request)
    const input = action(session),
      running = gal.act(userId, session.id, input)
    await expect(gal.act(userId, session.id, input)).rejects.toMatchObject({ code: 'TURN_RUNNING' })
    await expect(gal.act(userId, session.id, action(session))).rejects.toMatchObject({ code: 'TURN_RUNNING' })
    store.run("UPDATE turns SET lease_token='superseded'")
    finish(fixtureReply(provider.requests[0]!))
    await expect(running).rejects.toMatchObject({ code: 'LEASE_LOST' })
    expect(gal.get(userId, session.id).revision).toBe(0)
  })
  it('每日额度失败后保留记录，并允许不调用模型的结束动作', async () => {
    vi.stubEnv('GALGAME_DAILY_TURNS', '1')
    const { gal, session, userId, provider } = setup()
    const opening = (await gal.act(userId, session.id, action(session))).session
    await expect(gal.act(userId, session.id, action(opening))).rejects.toMatchObject({
      code: 'AI_DAILY_LIMIT',
    })
    const calls = provider.requests.length
    const ended = await gal.act(userId, session.id, action(opening, { kind: 'leave', choiceId: undefined }))
    expect(ended.session.status).toBe('ended')
    expect(provider.requests.length).toBe(calls)
  })
  it('关闭或缺少真实模型配置时不提供mock回退，也不创建新局', () => {
    const { store, userId, provider, gal } = setup()
    provider.available = false
    expect(() =>
      gal.create(userId, {
        mode: 'galgame',
        careerId: 'qa',
        player: { name: '小禾', identity: 'intern', avatar: 'leaf' },
      }),
    ).toThrow('暂未开放')
    expect(new GalgameService(store).provider.available).toBe(false)
  })
  it('回溯只保留真实前缀，清空独立手账，冻结角色身份和种子', async () => {
    const { gal, session, userId, store } = setup()
    const opening = (await gal.act(userId, session.id, action(session))).session
    const later = (
      await gal.act(
        userId,
        session.id,
        action(opening, {
          kind: 'message',
          choiceId: undefined,
          text: '这条未来私聊不应出现',
          channel: 'private',
          recipientId: 'zhou',
        }),
      )
    ).session
    gal.journal(userId, session.id, session.branchId, '独立手账')
    const branch = gal.fork(userId, session.id, { branchId: later.branchId, eventSeq: opening.eventSeq })
    expect(branch.player).toEqual(opening.player)
    expect(branch.revision).toBe(0)
    expect(branch.messages.map((m) => m.text)).toEqual(opening.messages.map((m) => m.text))
    expect(gal.journal(userId, session.id, branch.branchId).text).toBe('')
    const next = await gal.act(userId, session.id, action(branch))
    expect(next.session.eventSeq).toBe(later.eventSeq + 1)
    expect(state(store, later.branchId).minutes).toBe(opening.minutes)
  })
  it('共享API按服务器模式分派；跨账号与冒充模式请求不能读取或写入', async () => {
    const { sessions, gal, session, auth, userId } = setup()
    expect(sessions.list(userId).sessions[0]?.mode).toBe('galgame')
    const other = auth.guest().user.id
    expect(() => sessions.get(other, session.id)).toThrow()
    expect(() => sessions.journal(other, session.id)).toThrow()
    expect(() =>
      sessions.parseAction(userId, session.id, { ...action(session), kind: 'switch_role' }),
    ).toThrow()
    await expect(
      gal.act(
        userId,
        session.id,
        action(session, { kind: 'act', shareFactIds: ['dev-clue'], text: '分享', choiceId: undefined }),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_UNAVAILABLE' })
    expect(
      GalgameActionSchema.safeParse(
        action(session, { kind: 'act', text: '尝试', channel: 'private', recipientId: 'zhou' }),
      ).success,
    ).toBe(false)
  })
})

describe('混合存档与旧版本兼容', () => {
  it('1.2混合存档恢复真实文本、私聊、产物与分支，单局导出不混入其他记录', async () => {
    const { gal, story, session, auth, userId, store } = setup()
    const old = story.create(userId, { packId: demoPack.id })
    const opening = (await gal.act(userId, session.id, action(session))).session
    const done = (
      await gal.act(
        userId,
        session.id,
        action(opening, { kind: 'submit_artifact', choiceId: undefined, artifact: work(opening) }),
      )
    ).session
    gal.journal(userId, session.id, session.branchId, '我的真实手账')
    gal.fork(userId, session.id, { branchId: done.branchId, eventSeq: opening.eventSeq })
    const archive = SaveArchiveV12Schema.parse(auth.export(userId))
    expect(archive.sessions).toHaveLength(2)
    const target = auth.guest().user.id,
      importer = new ArchiveService(store),
      restored = importer.import(target, archive)
    expect(restored.importedSessions).toBe(2)
    const copyId = gal.list(target)[0]!.id,
      copy = gal.get(target, copyId),
      root = copy.branches.find((b) => !b.parentBranchId)!
    expect(copy.branches).toHaveLength(2)
    expect(gal.get(target, copyId, root.id).artifacts).toEqual(done.artifacts)
    expect(gal.journal(target, copyId, root.id).text).toBe('我的真实手账')
    expect(importer.import(target, archive).replayed).toBe(true)
    const single = SaveArchiveV12Schema.parse(auth.export(userId, session.id))
    expect(single.sessions).toHaveLength(1)
    expect(single.packageRefs[0]?.id).toBe(session.packId)
    expect(single.instances).toEqual([])
    expect((auth.export(userId, old.id) as { schemaVersion: string }).schemaVersion).toBe('1.1')
    expect(() => auth.export(target, old.id)).toThrow()
  })
  it('重签校验和也无法伪造场景效果、跨路线记忆、正文或复盘证据；导入全部回滚', async () => {
    const { gal, story, session, auth, userId, store } = setup()
    story.create(userId, { packId: demoPack.id })
    await gal.act(userId, session.id, action(session))
    const archive = SaveArchiveV12Schema.parse(auth.export(userId)),
      before = store.get<{ n: number }>('SELECT COUNT(*) n FROM sessions')!.n
    const event = archive.events.find((e) => e.session_id === session.id && e.kind === 'begin')!
    const world = JSON.parse(event.state_after) as GalgameWorldState
    world.knowledge.lin.push('dev-clue')
    event.state_after = JSON.stringify(world)
    expect(() => new ArchiveService(store).import(userId, resign(archive))).toThrow('复现')
    expect(store.get<{ n: number }>('SELECT COUNT(*) n FROM sessions')!.n).toBe(before)
  })
  it('账号删除通过外键清理职业实例、模型调用和每日额度', async () => {
    const { gal, session, userId, store } = setup()
    await gal.act(userId, session.id, action(session))
    store.run('DELETE FROM users WHERE id=?', userId)
    for (const table of ['sessions', 'galgame_instances', 'galgame_model_attempts', 'galgame_quotas'])
      expect(store.get<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`)!.n).toBe(0)
  })
  it('每个冻结岗位都包含可核验出处、明确权限、虚构材料和现有19项美术', () => {
    for (const pack of galgameDefinitions) {
      expect(pack.domainReviewStatus).toBe('pending')
      expect(pack.assetRefs).toHaveLength(19)
      expect(pack.facts.every((f) => f.origin === 'fictional-case')).toBe(true)
      expect(pack.sources[0]?.url).toMatch(/^https:/)
      expect(pack.authority.join('')).toMatch(/负责人|审批|发布|部署/)
    }
  })
})
