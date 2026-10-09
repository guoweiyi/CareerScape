// Deterministic model replies for tests only. Production never imports this module.
import type { z } from 'zod'
import type { GalgameModelRequest, GalgameModelUsage, GalgameProvider } from '../../packages/agent/galgame'
import type { NpcId } from '../../packages/contracts/galgame'
type Context = {
  actionKind: string
  currentInput: string
  occupationTitle: string
  minutes?: number
  facts?: { id: string; text: string }[]
  sources: { id: string }[]
  characters?: { id: NpcId; goal: string }[]
  character?: { id: NpcId; name: string }
  isReviewer?: boolean
  artifact?: { id: string; fields: Record<string, string> } | null
  artifacts?: { id: string }[]
  evidence?: { eventSeq: number; artifactId?: string }[]
}
export function fixtureReply(request: GalgameModelRequest): unknown {
  const c = request.context as unknown as Context
  const mentor: NpcId = c.occupationTitle.includes('测试')
    ? 'lin'
    : c.occupationTitle.includes('前端')
      ? 'zhou'
      : 'xu'
  if (request.role === 'director')
    return {
      scene: {
        id: `scene-${c.minutes || 0}-${c.actionKind}`,
        title: c.actionKind === 'begin' ? '新同事的第一项工作' : '把判断落到材料上',
        background: 'office',
        narration: `这是虚构的栖木工作案例。${c.facts?.[0]?.text || '请先收集材料，明确未知事项。'}`,
        factIds: (c.facts || []).slice(0, 1).map((f) => f.id),
      },
      eventType:
        c.actionKind === 'begin'
          ? 'briefing'
          : c.actionKind === 'submit_artifact'
            ? 'review'
            : 'investigation',
      minutes: c.actionKind === 'begin' ? 0 : 8,
      taskStatus: c.actionKind === 'submit_artifact' ? 'review' : 'working',
      choices: [
        { id: 'inspect', label: '先整理已有材料，标记尚未验证的部分', intent: 'investigate' },
        { id: 'clarify', label: '向导师确认任务与交接要求', intent: 'clarify' },
      ],
      activeNpcIds: [mentor, mentor === 'zhou' ? 'lin' : 'zhou'],
      goals:
        c.actionKind === 'begin'
          ? c.characters?.map((person) => ({ characterId: person.id, goal: person.goal })) || []
          : [],
    }
  if (request.role === 'npc') {
    const facts = (c.facts || []).filter((f) => !f.id.includes('clue') || c.currentInput.includes('线索'))
    const review =
      c.isReviewer && c.artifact
        ? {
            decision: Object.values(c.artifact.fields).some((text) => text.includes('需要修改'))
              ? 'revise'
              : 'accepted',
            feedback:
              '这份模拟产物已区分观察、假设与未验证事项，可以交给负责人进一步复核。没有执行测试或部署。',
          }
        : null
    return {
      text: `${c.character?.name}：${facts.at(-1)?.text || '先把已知材料和待确认的问题列出来。'}${review ? review.feedback : '我们可以一起确认下一步，但不能替负责人审批。'}`,
      expression: review ? 'relaxed' : 'thinking',
      factIds: facts.map((f) => f.id),
      review,
    }
  }
  const evidence = c.evidence!.at(-1)!
  return {
    summary: '你在这段模拟工作中区分了材料、判断与待验证事项。接下来可以继续练习清晰的工作交接。',
    observations: [
      {
        text: '这次实际行动体现了围绕材料沟通的工作习惯。',
        eventSeq: evidence.eventSeq,
        ...(evidence.artifactId ? { artifactId: evidence.artifactId } : {}),
        sourceId: c.sources[0]!.id,
      },
    ],
    nextSteps: ['用新的虚构案例练习一份更清晰的交接说明。'],
    interviewPractice: '我在模拟职业项目中整理材料、明确未知事项，并练习了向同事交接。',
  }
}
export class FixtureGalgameProvider implements GalgameProvider {
  readonly name = 'openai-compatible' as const
  available = true
  model = 'test-fixture'
  requests: GalgameModelRequest[] = []
  intercept?: (request: GalgameModelRequest) => unknown | Promise<unknown>
  async generate<T>(
    schema: z.ZodType<T>,
    request: GalgameModelRequest,
    _signal: AbortSignal,
    record: (usage: GalgameModelUsage) => void,
  ): Promise<T> {
    this.requests.push(structuredClone(request))
    try {
      const result = this.intercept ? await this.intercept(request) : fixtureReply(request)
      const parsed = schema.parse(result)
      record({
        model: this.model,
        role: request.role,
        status: 'succeeded',
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 1,
        failureCode: null,
      })
      return parsed
    } catch (error) {
      record({
        model: this.model,
        role: request.role,
        status: 'failed',
        inputTokens: null,
        outputTokens: null,
        latencyMs: 1,
        failureCode: 'TEST_FAILURE',
      })
      throw error
    }
  }
}
