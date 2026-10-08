import { z } from 'zod'
import {
  ContentPackSchema,
  NarrativeMessageSchema,
  StoryNodeSchema,
  type ContentPack,
  type StoryNode,
} from '../contracts'
import { assemble, validatePack } from '../narrative/engine'

export interface StudioDiagnostic {
  code: string
  message: string
  nodeId?: string
  choiceId?: string
}
export interface StudioGraphNode {
  id: string
  title: string
  nodeType: StoryNode['nodeType']
  level: number
  /** Stable position within this level, not the source array index. */
  index: number
  x: number
  y: number
  reachable: boolean
  ending: boolean
}
export interface StudioGraphEdge {
  id: string
  from: string
  to: string
  choiceId: string
  label: string
  dangling: boolean
}
export interface StudioGraph {
  nodes: StudioGraphNode[]
  edges: StudioGraphEdge[]
  diagnostics: StudioDiagnostic[]
}

const choicePatchSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(140).optional(),
    description: z.string().max(300).optional(),
    targetNodeId: z.string().min(1).optional(),
  })
  .strict()
export const StudioNodePatchSchema = z
  .object({
    title: StoryNodeSchema.shape.title.optional(),
    backgroundId: StoryNodeSchema.shape.backgroundId.optional(),
    messages: z.array(NarrativeMessageSchema).min(1).max(8).optional(),
    explanation: StoryNodeSchema.shape.metadata.shape.explanation.optional(),
    choices: z.array(choicePatchSchema).max(8).optional(),
  })
  .strict()
export type StudioNodePatch = z.infer<typeof StudioNodePatchSchema>
export class StudioError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'StudioError'
  }
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
function fieldDiagnostics(error: z.ZodError): StudioDiagnostic[] {
  return error.issues
    .slice(0, 40)
    .map((issue) => ({
      code: 'SCHEMA',
      message: `字段 ${issue.path.join('.') || '内容包'}：${issue.message}`,
    }))
}

function analyzeGraph(pack: ContentPack) {
  const diagnostics: StudioDiagnostic[] = []
  const byId = new Map<string, StoryNode>()
  for (const node of pack.nodes) {
    if (byId.has(node.nodeId))
      diagnostics.push({
        code: 'DUPLICATE_NODE',
        nodeId: node.nodeId,
        message: `节点 ID「${node.nodeId}」重复；图中只投影第一份，需在高级 JSON 中修复。`,
      })
    else byId.set(node.nodeId, node)
  }
  const ids = [...byId.keys()].sort(compare)
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]))
  const edges: StudioGraphEdge[] = []
  for (const from of ids) {
    const node = byId.get(from)!
    const sortedEdges = [...node.outgoingEdges].sort(
      (a, b) => compare(a.choiceId, b.choiceId) || compare(a.to, b.to),
    )
    for (const [index, edge] of sortedEdges.entries()) {
      const choice = node.choices.find((item) => item.id === edge.choiceId)
      const dangling = !byId.has(edge.to)
      edges.push({
        id: JSON.stringify([from, edge.choiceId, edge.to, index]),
        from,
        to: edge.to,
        choiceId: edge.choiceId,
        label: choice?.label ?? edge.choiceId,
        dangling,
      })
      if (dangling)
        diagnostics.push({
          code: 'DANGLING_EDGE',
          nodeId: from,
          choiceId: edge.choiceId,
          message: `节点「${node.title}」的边指向不存在的节点「${edge.to}」。`,
        })
      else adjacency.get(from)!.add(edge.to)
      if (!choice)
        diagnostics.push({
          code: 'EDGE_CHOICE_MISSING',
          nodeId: from,
          choiceId: edge.choiceId,
          message: `节点「${node.title}」的边没有对应的现有选项「${edge.choiceId}」。`,
        })
      else {
        if (choice.targetNodeId !== edge.to)
          diagnostics.push({
            code: 'EDGE_TARGET_MISMATCH',
            nodeId: from,
            choiceId: edge.choiceId,
            message: `选项「${choice.label}」的目标与作者图边不一致。`,
          })
        if (JSON.stringify(choice.conditions) !== JSON.stringify(edge.conditions))
          diagnostics.push({
            code: 'EDGE_CONDITIONS_MISMATCH',
            nodeId: from,
            choiceId: edge.choiceId,
            message: `选项「${choice.label}」与作者图边的条件不一致；请通过高级 JSON 修复规则。`,
          })
      }
    }
    for (const choice of node.choices) {
      if (!byId.has(choice.targetNodeId))
        diagnostics.push({
          code: 'CHOICE_TARGET_MISSING',
          nodeId: from,
          choiceId: choice.id,
          message: `选项「${choice.label}」的目标「${choice.targetNodeId}」不存在。`,
        })
      const matches = node.outgoingEdges.filter((edge) => edge.choiceId === choice.id)
      if (!matches.length)
        diagnostics.push({
          code: 'EDGE_MISSING',
          nodeId: from,
          choiceId: choice.id,
          message: `选项「${choice.label}」缺少对应的作者图边。`,
        })
      if (matches.length > 1)
        diagnostics.push({
          code: 'DUPLICATE_EDGE',
          nodeId: from,
          choiceId: choice.id,
          message: `选项「${choice.label}」存在多条作者图边；请通过高级 JSON 明确唯一目标。`,
        })
    }
  }
  // Every traversal uses a visited set. Invalid cycles cannot make the projection loop forever.
  const reachableFrom = (start: string) => {
    const reached = new Set<string>(),
      pending = byId.has(start) ? [start] : []
    while (pending.length) {
      const current = pending.pop()!
      if (reached.has(current)) continue
      reached.add(current)
      for (const next of adjacency.get(current)!) if (!reached.has(next)) pending.push(next)
    }
    return reached
  }
  const reachable = reachableFrom(pack.startNodeId)
  if (!byId.has(pack.startNodeId))
    diagnostics.push({ code: 'START_MISSING', message: `起始节点「${pack.startNodeId}」不存在。` })
  for (const id of ids)
    if (!reachable.has(id))
      diagnostics.push({
        code: 'UNREACHABLE_NODE',
        nodeId: id,
        message: `节点「${byId.get(id)!.title}」不能从当前起点到达。`,
      })
  if (![...byId.values()].some((node) => node.metadata.endingId))
    diagnostics.push({ code: 'NO_ENDING', message: '作者图没有登记结局，不能完成可玩内容检查。' })

  // Condense strongly connected components, then lay out the resulting DAG by longest predecessor path.
  // The schema caps this editor at eight nodes; pairwise reachability avoids recursive cycle handling.
  const paths = new Map(ids.map((id) => [id, reachableFrom(id)]))
  const componentOf = new Map<string, number>(),
    components: string[][] = []
  for (const id of ids) {
    if (componentOf.has(id)) continue
    const members = ids.filter(
      (other) => !componentOf.has(other) && paths.get(id)!.has(other) && paths.get(other)!.has(id),
    )
    const component = components.length
    members.forEach((member) => componentOf.set(member, component))
    components.push(members)
    if (members.length > 1 || adjacency.get(id)!.has(id))
      diagnostics.push({
        code: 'CYCLE',
        nodeId: id,
        message: `发现循环区域：${members.map((member) => `「${byId.get(member)!.title}」`).join('、')}。当前作者图要求无环。`,
      })
  }
  const outgoing = components.map(() => new Set<number>()),
    indegree = components.map(() => 0),
    levels = components.map(() => 0)
  for (const [from, targets] of adjacency)
    for (const to of targets) {
      const a = componentOf.get(from)!,
        b = componentOf.get(to)!
      if (a !== b && !outgoing[a]!.has(b)) {
        outgoing[a]!.add(b)
        indegree[b] = indegree[b]! + 1
      }
    }
  const queue = components.map((_, index) => index).filter((index) => indegree[index] === 0)
  while (queue.length) {
    const component = queue.shift()!
    for (const next of [...outgoing[component]!].sort((a, b) => a - b)) {
      levels[next] = Math.max(levels[next]!, levels[component]! + 1)
      indegree[next] = indegree[next]! - 1
      if (indegree[next] === 0) {
        queue.push(next)
        queue.sort((a, b) => a - b)
      }
    }
  }
  const rows = new Map<number, number>()
  const nodes = ids
    .map((id) => ({ id, level: levels[componentOf.get(id)!]! }))
    .sort((a, b) => a.level - b.level || compare(a.id, b.id))
    .map(({ id, level }) => {
      const node = byId.get(id)!,
        index = rows.get(level) ?? 0
      rows.set(level, index + 1)
      return {
        id,
        title: node.title,
        nodeType: node.nodeType,
        level,
        index,
        x: level * 300,
        y: index * 180,
        reachable: reachable.has(id),
        ending: Boolean(node.metadata.endingId),
      }
    })
  return { nodes, edges, diagnostics }
}

/** Local authoring diagnostics only. Server review, publication and physical resource gates still apply. */
export function diagnoseStoryPack(input: unknown): StudioDiagnostic[] {
  const parsed = ContentPackSchema.safeParse(input)
  if (!parsed.success) return fieldDiagnostics(parsed.error)
  const pack = parsed.data,
    diagnostics = analyzeGraph(pack).diagnostics
  try {
    const validation = validatePack(pack)
    diagnostics.push(...validation.issues.map((message) => ({ code: 'PACK_VALIDATION', message })))
    if (validation.valid && !diagnostics.length) {
      // Match the server's candidate publication check without mutating status or saving any data.
      const candidate = ContentPackSchema.parse({
        ...pack,
        contentStatus: 'published',
        events: pack.events.map((event) => ({ ...event, contentStatus: 'published' })),
      })
      try {
        for (const seed of ['publish-0', 'publish-1', 'publish-2', 'publish-3', 'publish-4'])
          assemble(candidate, seed)
      } catch (error) {
        diagnostics.push({
          code: 'ASSEMBLY_GAP',
          message: `组局预检未通过：${error instanceof Error ? error.message : '缺少相容候选'}。`,
        })
      }
    }
  } catch (error) {
    diagnostics.push({
      code: 'PACK_VALIDATION',
      message: `规则预检未完成：${error instanceof Error ? error.message : '内容无效'}。`,
    })
  }
  return diagnostics.filter(
    (item, index, all) =>
      all.findIndex(
        (other) =>
          other.code === item.code &&
          other.message === item.message &&
          other.nodeId === item.nodeId &&
          other.choiceId === item.choiceId,
      ) === index,
  )
}

/** Stable read-only projection. Malformed schema returns diagnostics instead of throwing in the editor. */
export function projectStoryGraph(pack: ContentPack): StudioGraph {
  const parsed = ContentPackSchema.safeParse(pack)
  if (!parsed.success) return { nodes: [], edges: [], diagnostics: fieldDiagnostics(parsed.error) }
  const { nodes, edges } = analyzeGraph(parsed.data)
  return { nodes, edges, diagnostics: diagnoseStoryPack(parsed.data) }
}

/** Edits existing draft nodes only; graph-level problems remain visible until repaired and checked server-side. */
export function updateStoryNode(pack: ContentPack, nodeId: string, rawPatch: StudioNodePatch): ContentPack {
  const parsed = ContentPackSchema.safeParse(pack)
  if (!parsed.success)
    throw new StudioError(
      'INVALID_PACK',
      fieldDiagnostics(parsed.error)
        .map((item) => item.message)
        .join('；'),
    )
  if (parsed.data.contentStatus !== 'draft')
    throw new StudioError('IMMUTABLE_VERSION', '只有草稿可以编辑；请先复制为新草稿。')
  const parsedPatch = StudioNodePatchSchema.safeParse(rawPatch)
  if (!parsedPatch.success)
    throw new StudioError(
      'INVALID_PATCH',
      fieldDiagnostics(parsedPatch.error)
        .map((item) => item.message)
        .join('；'),
    )
  const next = parsed.data,
    patch = parsedPatch.data
  const matchingNodes = next.nodes.filter((node) => node.nodeId === nodeId)
  if (!matchingNodes.length)
    throw new StudioError('NODE_NOT_FOUND', '所选节点不存在；图形编辑器不创建新节点。')
  if (matchingNodes.length > 1)
    throw new StudioError('DUPLICATE_NODE', '节点 ID 重复，请先通过高级 JSON 修复。')
  const node = matchingNodes[0]!
  if (patch.title !== undefined) node.title = patch.title
  if (patch.backgroundId !== undefined) node.backgroundId = patch.backgroundId
  if (patch.messages !== undefined) node.messages = patch.messages
  if (patch.explanation !== undefined) node.metadata.explanation = patch.explanation
  const patchedIds = new Set<string>()
  for (const change of patch.choices ?? []) {
    if (patchedIds.has(change.id))
      throw new StudioError('DUPLICATE_CHOICE_PATCH', '同一选项不能在一次编辑中重复修改。')
    patchedIds.add(change.id)
    const matchingChoices = node.choices.filter((choice) => choice.id === change.id)
    if (matchingChoices.length !== 1)
      throw new StudioError('CHOICE_NOT_FOUND', '只能编辑当前节点已有且 ID 唯一的选项。')
    const choice = matchingChoices[0]!
    if (change.label !== undefined) choice.label = change.label
    if (change.description !== undefined) choice.description = change.description
    if (change.targetNodeId !== undefined) {
      if (!next.nodes.some((target) => target.nodeId === change.targetNodeId))
        throw new StudioError('TARGET_NOT_FOUND', '请选择当前内容包中已存在的目标节点。')
      const matchingEdges = node.outgoingEdges.filter((edge) => edge.choiceId === choice.id)
      if (matchingEdges.length > 1)
        throw new StudioError('AMBIGUOUS_EDGE', '这个选项存在多条边，请先通过高级 JSON 修复。')
      if (matchingEdges.some((edge) => JSON.stringify(edge.conditions) !== JSON.stringify(choice.conditions)))
        throw new StudioError(
          'EDGE_CONDITIONS_MISMATCH',
          '选项与边的条件不一致；图形编辑器不会改写 DSL，请通过高级 JSON 修复。',
        )
      choice.targetNodeId = change.targetNodeId
      if (matchingEdges[0]) matchingEdges[0].to = change.targetNodeId
      else
        node.outgoingEdges.push({
          choiceId: choice.id,
          to: change.targetNodeId,
          conditions: structuredClone(choice.conditions),
        })
    }
  }
  if (patch.backgroundId !== undefined || patch.messages !== undefined) {
    const required = new Set<string>([`bg_${node.backgroundId}_day_wide`])
    for (const message of [...node.messages, ...node.choices.flatMap((choice) => choice.messages)]) {
      if (message.speakerId === 'narrator') continue
      required.add(`chr_${message.speakerId}_work_half_${message.expression}`)
      required.add(`chr_${message.speakerId}_work_half_neutral`)
      required.add(`avatar_${message.speakerId}_neutral`)
    }
    // Replace dependencies owned by these controls; retain other explicit author references.
    const managed =
      /^(?:bg_(?:office|meeting|testing|terrace)_day_wide|chr_(?:lin|zhou|xu)_work_half_(?:neutral|relaxed|thinking|serious)|avatar_(?:lin|zhou|xu)_neutral)$/
    node.assetRefs = [...new Set([...node.assetRefs.filter((ref) => !managed.test(ref)), ...required])]
    next.assetRefs = [...new Set([...next.assetRefs, ...required])]
  }
  return ContentPackSchema.parse(next)
}
