import {
  GalgameWorldStateSchema,
  type GalgameAction,
  type GalgameDefinition,
  type GalgameGeneration,
  type GalgameMessage,
  type GalgameWorldState,
  type NpcId,
} from '../contracts/galgame'
import { invariant, canonical } from '../database'

export const npcIds: NpcId[] = ['lin', 'zhou', 'xu']
export function startGalgame(definition: GalgameDefinition): GalgameWorldState {
  const knowledge = Object.fromEntries(
    ['player', ...npcIds].map((person) => [
      person,
      definition.facts
        .filter((fact) => fact.knownBy.includes(person as 'player' | NpcId))
        .map((fact) => fact.id),
    ]),
  )
  return GalgameWorldStateSchema.parse({
    phase: 'preparing',
    minutes: 0,
    scene: null,
    characters: structuredClone(definition.characters),
    choices: [],
    tasks: [{ id: definition.task.id, title: definition.task.title, status: 'open' }],
    artifacts: [],
    knowledge,
    memories: { lin: [], zhou: [], xu: [] },
    outcome: null,
    debrief: null,
  })
}
export function prepareGalgameAction(
  definition: GalgameDefinition,
  before: GalgameWorldState,
  action: GalgameAction,
  eventSeq: number,
) {
  const state = structuredClone(before)
  if (action.kind === 'debrief') {
    invariant(
      state.phase === 'ended' && !state.debrief,
      'DEBRIEF_UNAVAILABLE',
      409,
      '请先结束这段工作；已有复盘可以直接回看。',
    )
    return state
  }
  invariant(state.phase !== 'ended', 'GAME_ENDED', 409, '这段工作已经结束，可以复盘或回溯。')
  invariant(
    action.kind === 'leave' ||
      (action.kind === 'begin' ? state.phase === 'preparing' : state.phase === 'playing'),
    'ACTION_UNAVAILABLE',
    409,
    '请先完成开场，或回看已经开始的故事。',
  )
  if (action.kind === 'choice')
    invariant(
      state.choices.some((choice) => choice.id === action.choiceId),
      'CHOICE_UNAVAILABLE',
      409,
      '该选项不属于当前场景。',
    )
  if (action.artifact) {
    invariant(
      state.artifacts.length < 12 && !state.artifacts.some((artifact) => artifact.id === action.artifact!.id),
      'ARTIFACT_LIMIT',
      409,
      '产物编号已使用，或本局已保存12份产物。',
    )
    invariant(action.artifact.taskId === definition.task.id, 'ARTIFACT_TASK', 400, '产物不属于当前任务。')
    invariant(
      canonical(Object.keys(action.artifact.fields).sort()) ===
        canonical(definition.artifactFields.map((field) => field.id).sort()),
      'ARTIFACT_FIELDS',
      400,
      '请完整填写当前岗位的工作产物字段。',
    )
    state.artifacts.push({ ...action.artifact, submittedAtEventSeq: eventSeq })
    invariant(
      Buffer.byteLength(JSON.stringify(state.artifacts), 'utf8') <= 64000,
      'ARTIFACT_CAPACITY',
      409,
      '本局工作产物容量已满，请精简内容或另开一段故事。',
    )
  }
  for (const factId of action.shareFactIds || []) {
    invariant(state.knowledge.player.includes(factId), 'FACT_NOT_KNOWN', 400, '只能分享已经获得的材料。')
    for (const person of npcIds)
      if (!state.knowledge[person].includes(factId)) state.knowledge[person].push(factId)
  }
  return state
}
export function galgameInputText(
  before: GalgameWorldState,
  action: GalgameAction,
  definition: GalgameDefinition,
) {
  if (action.kind === 'choice') return before.choices.find((choice) => choice.id === action.choiceId)!.label
  if (action.kind === 'submit_artifact') return `提交工作产物：${definition.task.title}`
  const shared = (action.shareFactIds || []).map(
    (factId) => definition.facts.find((fact) => fact.id === factId)!.text,
  )
  return (
    [action.text, ...shared].filter(Boolean).join('\n') ||
    (
      {
        begin: '开始今天的工作故事',
        explain: '请解释当前任务涉及的职业工作',
        leave: '结束并保存这段工作',
        debrief: '根据这段模拟工作生成就业复盘',
      } as Record<string, string>
    )[action.kind]!
  )
}
export function applyGalgameGeneration(
  definition: GalgameDefinition,
  before: GalgameWorldState,
  action: GalgameAction,
  generation: GalgameGeneration,
  eventSeq: number,
  visibleEventSeqs: number[],
) {
  const state = prepareGalgameAction(definition, before, action, eventSeq)
  const messages: Pick<GalgameMessage, 'speakerId' | 'text' | 'expression'>[] = []
  const knownFacts = (ids: string[], allowed: string[]) =>
    invariant(
      new Set(ids).size === ids.length && ids.every((id) => allowed.includes(id)),
      'AI_UNKNOWN_FACT',
      422,
      '生成内容引用了尚未获知的材料，未保存。',
    )
  if (action.kind === 'leave') {
    invariant(
      !generation.director && !generation.npcs.length && !generation.debrief,
      'AI_INVALID_EFFECT',
      422,
      '结束动作不能夹带剧情效果。',
    )
    state.phase = 'ended'
    state.outcome = state.tasks.every((task) => task.status === 'done')
      ? 'completed'
      : before.phase === 'preparing'
        ? 'stopped'
        : 'handoff'
    state.choices = []
    return { state, messages }
  }
  if (action.kind === 'debrief') {
    invariant(
      generation.debrief && !generation.director && !generation.npcs.length,
      'AI_INVALID_DEBRIEF',
      422,
      '复盘结果不完整，未保存。',
    )
    for (const observation of generation.debrief.observations) {
      invariant(
        visibleEventSeqs.includes(observation.eventSeq) &&
          definition.sources.some((source) => source.id === observation.sourceId),
        'AI_DEBRIEF_EVIDENCE',
        422,
        '复盘必须引用本路线的实际行动与岗位资料。',
      )
      if (observation.artifactId)
        invariant(
          state.artifacts.some(
            (artifact) =>
              artifact.id === observation.artifactId && artifact.submittedAtEventSeq <= observation.eventSeq,
          ),
          'AI_DEBRIEF_ARTIFACT',
          422,
          '复盘引用了不存在或尚未提交的产物。',
        )
    }
    state.debrief = {
      ...generation.debrief,
      interviewPractice:
        `模拟职业项目练习（不是实际任职经历）：${generation.debrief.interviewPractice}`.slice(0, 1200),
    }
    messages.push({ speakerId: 'narrator', text: state.debrief.summary, expression: 'neutral' })
    return { state: GalgameWorldStateSchema.parse(state), messages }
  }
  const workAction = ['begin', 'choice', 'act', 'submit_artifact'].includes(action.kind)
  invariant(
    Boolean(generation.director) === workAction && !generation.debrief,
    'AI_INVALID_EFFECT',
    422,
    '生成的事件类型与玩家行动不一致。',
  )
  if (generation.director) {
    const director = generation.director
    knownFacts(director.scene.factIds, state.knowledge.player)
    invariant(
      new Set(director.choices.map((choice) => choice.id)).size === director.choices.length &&
        new Set(director.activeNpcIds).size === director.activeNpcIds.length,
      'AI_DUPLICATE_CHOICE',
      422,
      '生成的选项或角色编号重复。',
    )
    invariant(
      action.kind === 'begin' || !director.goals.length,
      'AI_GOAL_CHANGE',
      422,
      '开场后的角色目标需要保持一致。',
    )
    invariant(
      new Set(director.goals.map((goal) => goal.characterId)).size === director.goals.length,
      'AI_DUPLICATE_GOAL',
      422,
      '同一角色的开场目标不能重复。',
    )
    for (const goal of director.goals)
      state.characters.find((character) => character.id === goal.characterId)!.goal = goal.goal
    state.scene = director.scene
    state.choices = director.choices
    state.minutes = Math.min(
      180,
      state.minutes + (action.kind === 'begin' ? 0 : Math.max(1, director.minutes)),
    )
    messages.push({ speakerId: 'narrator', text: director.scene.narration, expression: 'neutral' })
  }
  const expectedSpeakers =
    action.channel === 'private'
      ? [action.recipientId!]
      : generation.director
        ? action.artifact
          ? [
              definition.mentorId,
              ...generation.director.activeNpcIds.filter((id) => id !== definition.mentorId),
            ].slice(0, 2)
          : generation.director.activeNpcIds
        : [definition.mentorId]
  invariant(
    canonical(generation.npcs.map((npc) => npc.characterId).sort()) ===
      canonical([...expectedSpeakers].sort()),
    'AI_SPEAKER',
    422,
    '生成回复与当前可见角色不一致。',
  )
  for (const { characterId, response } of generation.npcs) {
    knownFacts(
      response.factIds,
      state.knowledge[characterId].filter(
        (id) => action.kind !== 'explain' || state.knowledge.player.includes(id),
      ),
    )
    const character = state.characters.find((character) => character.id === characterId)!
    if (action.kind !== 'explain') character.expression = response.expression
    if (action.kind !== 'explain') {
      const recipients =
        action.channel === 'private' ? (['player', characterId] as const) : (['player', ...npcIds] as const)
      for (const recipient of recipients)
        for (const factId of response.factIds)
          if (!state.knowledge[recipient].includes(factId)) state.knowledge[recipient].push(factId)
      state.memories[characterId] = [
        ...state.memories[characterId],
        { text: response.text.slice(0, 300), eventSeq },
      ].slice(-8)
    }
    if (response.review) {
      invariant(
        action.artifact && characterId === definition.mentorId,
        'AI_REVIEW_AUTHORITY',
        422,
        '只有导师能够复核本回合实际提交的产物。',
      )
      state.artifacts.at(-1)!.review = { ...response.review, reviewerId: characterId, eventSeq }
    }
    messages.push({ speakerId: characterId, text: response.text, expression: response.expression })
  }
  if (generation.director) {
    const requestedStatus = generation.director.taskStatus
    invariant(
      !['review', 'done'].includes(requestedStatus) || state.artifacts.length,
      'AI_MISSING_ARTIFACT',
      422,
      '任务评审需要实际提交的产物。',
    )
    invariant(
      requestedStatus !== 'done' ||
        state.artifacts.some((artifact) => artifact.review?.decision === 'accepted'),
      'AI_UNVERIFIED_COMPLETION',
      422,
      '完成任务需要导师复核通过的实际产物。',
    )
    state.tasks[0]!.status =
      state.artifacts.at(-1)?.review?.decision === 'accepted' ? 'done' : requestedStatus
    state.phase = 'playing'
    if (state.minutes >= 180 || state.tasks[0]!.status === 'done') {
      state.phase = 'ended'
      state.outcome = state.tasks[0]!.status === 'done' ? 'completed' : 'handoff'
      state.choices = []
    }
  }
  return { state: GalgameWorldStateSchema.parse(state), messages }
}
