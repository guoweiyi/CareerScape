import { describe, expect, it } from 'vitest'
import { ContentPackSchema } from '../packages/contracts'
import { demoPack } from '../packages/content/seed'
import {
  diagnoseStoryPack,
  projectStoryGraph,
  StudioNodePatchSchema,
  updateStoryNode,
} from '../packages/content/studio'

const draft = () => ContentPackSchema.parse({ ...demoPack, contentStatus: 'draft' })

describe('图形剧情编辑的稳定投影', () => {
  it('首包多结局 DAG 按最长前驱分层，不依赖节点与边的数组顺序', () => {
    const pack = draft(),
      projection = projectStoryGraph(pack)
    expect(projection.diagnostics).toEqual([])
    expect(projection.nodes).toHaveLength(pack.nodes.length)
    expect(projection.nodes.every((node) => node.reachable)).toBe(true)
    expect(projection.nodes.find((node) => node.id === 'arrival')).toMatchObject({
      level: 0,
      index: 0,
      x: 0,
      y: 0,
    })
    expect(projection.nodes.filter((node) => node.ending).map((node) => node.level)).toEqual([5, 5, 5])
    const levels = new Map(projection.nodes.map((node) => [node.id, node.level]))
    expect(projection.edges.every((edge) => levels.get(edge.from)! < levels.get(edge.to)!)).toBe(true)
    pack.nodes.reverse()
    pack.nodes.forEach((node) => node.outgoingEdges.reverse())
    expect(projectStoryGraph(pack)).toEqual(projection)
  })

  it('真实合流节点取最长前驱层级，卡片位置不重叠', () => {
    const pack = draft(),
      arrival = pack.nodes.find((node) => node.nodeId === 'arrival')!
    arrival.choices[0]!.targetNodeId = 'triage'
    arrival.outgoingEdges.find((edge) => edge.choiceId === arrival.choices[0]!.id)!.to = 'triage'
    const graph = projectStoryGraph(pack)
    expect(graph.nodes.find((node) => node.id === 'triage')?.level).toBe(2)
    expect(new Set(graph.nodes.map((node) => `${node.x}:${node.y}`)).size).toBe(graph.nodes.length)
  })

  it('循环、悬空边和未连通节点均有限返回并明确诊断', () => {
    const pack = draft(),
      arrival = pack.nodes.find((node) => node.nodeId === 'arrival')!
    for (const choice of arrival.choices) choice.targetNodeId = 'arrival'
    for (const edge of arrival.outgoingEdges) edge.to = 'arrival'
    arrival.outgoingEdges.push({ to: 'missing-node', choiceId: 'missing-choice', conditions: [] })
    const before = structuredClone(pack),
      graph = projectStoryGraph(pack)
    expect(graph.nodes).toHaveLength(pack.nodes.length)
    expect(
      graph.nodes.every(
        (node) => Number.isFinite(node.x) && Number.isFinite(node.y) && node.level < pack.nodes.length,
      ),
    ).toBe(true)
    expect(graph.diagnostics.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['CYCLE', 'DANGLING_EDGE', 'UNREACHABLE_NODE']),
    )
    expect(graph.edges.find((edge) => edge.to === 'missing-node')?.dangling).toBe(true)
    expect(pack).toEqual(before)
  })

  it('多节点强连通区域、缺起点、重复节点及非法schema不使编辑器崩溃', () => {
    const pack = draft(),
      briefing = pack.nodes.find((node) => node.nodeId === 'briefing')!
    briefing.outgoingEdges[0]!.to = 'arrival'
    briefing.choices[0]!.targetNodeId = 'arrival'
    expect(projectStoryGraph(pack).diagnostics.some((issue) => issue.code === 'CYCLE')).toBe(true)
    pack.startNodeId = 'absent'
    expect(projectStoryGraph(pack).diagnostics.some((issue) => issue.code === 'START_MISSING')).toBe(true)
    pack.nodes[1]!.nodeId = pack.nodes[0]!.nodeId
    expect(projectStoryGraph(pack).diagnostics.some((issue) => issue.code === 'DUPLICATE_NODE')).toBe(true)
    expect(projectStoryGraph({ ...pack, version: 0 }).nodes).toEqual([])
    expect(diagnoseStoryPack(null)[0]?.code).toBe('SCHEMA')
  })

  it('缺结局、规则前提不可达与组局缺槽沿用严检，预检不改变发布状态', () => {
    const missingEnd = draft()
    missingEnd.nodes.forEach((node) => {
      delete node.metadata.endingId
    })
    expect(diagnoseStoryPack(missingEnd).some((issue) => issue.code === 'NO_ENDING')).toBe(true)
    const unreachable = draft()
    unreachable.nodes
      .find((node) => node.nodeId === 'decision')!
      .choices.forEach((choice) => {
        choice.conditions = [{ op: 'flag', key: 'reported', equals: false }]
      })
    expect(diagnoseStoryPack(unreachable).some((issue) => issue.code === 'PACK_VALIDATION')).toBe(true)
    const missingSlot = draft()
    missingSlot.events.forEach((event) => {
      if (event.slot === 'ending') event.slot = 'work'
    })
    const before = structuredClone(missingSlot)
    expect(
      diagnoseStoryPack(missingSlot).some(
        (issue) => issue.code === 'ASSEMBLY_GAP' && issue.message.includes('ending'),
      ),
    ).toBe(true)
    expect(missingSlot).toEqual(before)
    expect(missingSlot.contentStatus).toBe('draft')
  })
})

describe('受约束草稿节点更新', () => {
  it('可修改展示字段，同时保留全部身份、版本、DSL及元数据', () => {
    const pack = draft(),
      before = structuredClone(pack),
      source = pack.nodes[0]!
    const changed = updateStoryNode(pack, source.nodeId, {
      title: '新的场景标题',
      backgroundId: 'meeting',
      explanation: '材料解释更新',
      messages: [{ speakerId: 'zhou', expression: 'thinking', text: '先核对实际观察。' }],
      choices: [{ id: source.choices[0]!.id, label: '修改标签', description: '修改说明' }],
    })
    const node = changed.nodes[0]!
    expect(node).toMatchObject({
      title: '新的场景标题',
      backgroundId: 'meeting',
      metadata: { explanation: '材料解释更新' },
    })
    expect(node.messages).toEqual([{ speakerId: 'zhou', expression: 'thinking', text: '先核对实际观察。' }])
    expect(node.conditions).toEqual(source.conditions)
    expect(node.effects).toEqual(source.effects)
    expect(node.outgoingEdges).toEqual(source.outgoingEdges)
    expect(
      node.choices.map((choice) => ({
        conditions: choice.conditions,
        effects: choice.effects,
        messages: choice.messages,
      })),
    ).toEqual(
      source.choices.map((choice) => ({
        conditions: choice.conditions,
        effects: choice.effects,
        messages: choice.messages,
      })),
    )
    expect(node.nodeId).toBe(source.nodeId)
    expect(node.packVersion).toBe(source.packVersion)
    expect(node.metadata.checkpoint).toBe(source.metadata.checkpoint)
    expect(changed.nodes.slice(1)).toEqual(before.nodes.slice(1))
    expect(pack).toEqual(before)
    node.choices[0]!.effects.push({ op: 'set_flag', key: 'helpAsked', value: true })
    expect(pack).toEqual(before)
  })

  it('目标变更同步唯一作者图边，保留条件、效果和其他边', () => {
    const pack = draft(),
      source = pack.nodes.find((node) => node.nodeId === 'decision')!,
      choice = source.choices[0]!,
      before = structuredClone(pack)
    const result = updateStoryNode(pack, source.nodeId, {
      choices: [{ id: choice.id, targetNodeId: 'ending-handoff' }],
    })
    const node = result.nodes.find((item) => item.nodeId === source.nodeId)!
    expect(node.choices[0]!.targetNodeId).toBe('ending-handoff')
    expect(node.outgoingEdges.find((edge) => edge.choiceId === choice.id)).toEqual({
      choiceId: choice.id,
      to: 'ending-handoff',
      conditions: choice.conditions,
    })
    expect(node.choices[0]!.conditions).toEqual(choice.conditions)
    expect(node.choices[0]!.effects).toEqual(choice.effects)
    expect(node.outgoingEdges.filter((edge) => edge.choiceId !== choice.id)).toEqual(
      source.outgoingEdges.filter((edge) => edge.choiceId !== choice.id),
    )
    expect(pack).toEqual(before)
    expect(diagnoseStoryPack(result).some((issue) => issue.code === 'UNREACHABLE_NODE')).toBe(true)
  })

  it('背景和人物表情变更同步节点依赖与包引用，保留冻结人物设定和其他节点', () => {
    const pack = draft(),
      source = pack.nodes[0]!,
      before = structuredClone(pack)
    source.assetRefs.push('author-material-card')
    const changed = updateStoryNode(pack, source.nodeId, {
      backgroundId: 'terrace',
      messages: [{ speakerId: 'zhou', text: '换到露台核对交接。', expression: 'serious' }],
    })
    expect(changed.nodes[0]!.assetRefs).toEqual(
      expect.arrayContaining([
        'bg_terrace_day_wide',
        'chr_zhou_work_half_serious',
        'chr_zhou_work_half_neutral',
        'avatar_zhou_neutral',
        'author-material-card',
      ]),
    )
    expect(changed.nodes[0]!.assetRefs).not.toContain(`bg_${source.backgroundId}_day_wide`)
    expect(changed.nodes[0]!.assetRefs.filter((ref) => ref.includes('zhou'))).toHaveLength(3)
    expect(changed.assetRefs).toEqual(pack.assetRefs)
    expect(changed.characters).toEqual(before.characters)
    expect(changed.nodes.slice(1)).toEqual(before.nodes.slice(1))
    expect(pack.nodes[0]!.backgroundId).toBe(before.nodes[0]!.backgroundId)
    const missingReference = draft()
    missingReference.assetRefs = missingReference.assetRefs.map((ref) =>
      ref === 'chr_zhou_work_half_serious' ? 'other-author-reference' : ref,
    )
    expect(
      updateStoryNode(missingReference, 'arrival', {
        messages: [{ speakerId: 'zhou', text: '表情资产需要登记。', expression: 'serious' }],
      }).assetRefs,
    ).toContain('chr_zhou_work_half_serious')
  })

  it.each(['published', 'approved', 'auto_checked', 'withdrawn'] as const)(
    '%s 状态不可通过图形编辑修改',
    (status) => {
      expect(() =>
        updateStoryNode({ ...draft(), contentStatus: status }, 'arrival', { title: '不能修改' }),
      ).toThrow('只有草稿')
    },
  )

  it('拒绝额外权限、身份、版本、条件效果、非法消息与越界文本', () => {
    const pack = draft()
    for (const patch of [
      { nodeId: 'other' },
      { packVersion: 99 },
      { effects: [] },
      { conditions: [] },
      { metadata: { endingId: 'verified' } },
      { choices: [{ id: 'arrive_begin', effects: [] }] },
      { messages: [{ speakerId: 'outsider', expression: 'neutral', text: 'bad' }] },
      { messages: [{ speakerId: 'lin', expression: 'unknown', text: 'bad' }] },
      { title: 'x'.repeat(101) },
    ]) {
      expect(StudioNodePatchSchema.safeParse(patch).success).toBe(false)
      expect(() => updateStoryNode(pack, 'arrival', patch as never)).toThrow()
    }
  })

  it('未知节点/选项/目标和重复修改被拒绝，失败保持输入不变', () => {
    const pack = draft(),
      before = structuredClone(pack)
    expect(() => updateStoryNode(pack, 'new-node', { title: '新增' })).toThrow('不创建新节点')
    expect(() =>
      updateStoryNode(pack, 'arrival', { choices: [{ id: 'new-choice', label: '新增' }] }),
    ).toThrow('已有')
    expect(() =>
      updateStoryNode(pack, 'arrival', { choices: [{ id: 'arrive_begin', targetNodeId: 'missing' }] }),
    ).toThrow('已存在')
    expect(() =>
      updateStoryNode(pack, 'arrival', {
        title: '不应落盘',
        choices: [
          { id: 'arrive_begin', label: '第一次' },
          { id: 'arrive_begin', label: '重复' },
        ],
      }),
    ).toThrow('重复修改')
    expect(pack).toEqual(before)
  })

  it('不会借同步目标改写不一致DSL或任意多条边，缺失边可由既有选项恢复', () => {
    const pack = draft(),
      node = pack.nodes[0]!,
      choice = node.choices[0]!
    node.outgoingEdges[0]!.conditions = [{ op: 'flag', key: 'helpAsked', equals: true }]
    expect(() =>
      updateStoryNode(pack, node.nodeId, { choices: [{ id: choice.id, targetNodeId: 'triage' }] }),
    ).toThrow('不会改写 DSL')
    node.outgoingEdges[0]!.conditions = structuredClone(choice.conditions)
    node.outgoingEdges.push(structuredClone(node.outgoingEdges[0]!))
    expect(() =>
      updateStoryNode(pack, node.nodeId, { choices: [{ id: choice.id, targetNodeId: 'triage' }] }),
    ).toThrow('多条边')
    node.outgoingEdges = node.outgoingEdges.filter((edge) => edge.choiceId !== choice.id)
    const repaired = updateStoryNode(pack, node.nodeId, {
      choices: [{ id: choice.id, targetNodeId: 'triage' }],
    })
    expect(repaired.nodes[0]!.outgoingEdges.find((edge) => edge.choiceId === choice.id)).toEqual({
      choiceId: choice.id,
      to: 'triage',
      conditions: choice.conditions,
    })
  })
})
