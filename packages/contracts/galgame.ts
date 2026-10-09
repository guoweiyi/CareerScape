import { z } from 'zod'

const key = z.string().min(1).max(100)
const short = z.string().trim().min(1).max(300)
export const CareerIdSchema = z.enum(['qa', 'frontend', 'product'])
export const IdentityIdSchema = z.enum(['intern', 'graduate', 'career-changer'])
export const NpcIdSchema = z.enum(['lin', 'zhou', 'xu'])
export const PlayerProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(24),
    identity: IdentityIdSchema,
    avatar: z.enum(['leaf', 'sun', 'star']),
    background: z.string().trim().max(500).default(''),
  })
  .strict()
export const GalgameSourceSchema = z
  .object({
    id: key,
    title: short,
    url: z.url(),
    publisher: short,
    consultedAt: z.string().date(),
    scope: short,
    summary: z.string().min(1).max(1200),
    rights: z.literal('citation-and-original-summary'),
  })
  .strict()
export const GalgameFactSchema = z
  .object({
    id: key,
    text: short,
    origin: z.literal('fictional-case'),
    knownBy: z
      .array(z.enum(['player', 'lin', 'zhou', 'xu']))
      .min(1)
      .max(4),
  })
  .strict()
export const GalgameCharacterSchema = z
  .object({
    id: NpcIdSchema,
    name: short,
    role: short,
    goal: short,
    expression: z.enum(['neutral', 'relaxed', 'thinking', 'serious']).default('neutral'),
  })
  .strict()
export const GalgameDefinitionSchema = z
  .object({
    mode: z.literal('galgame'),
    schemaVersion: z.literal(1),
    id: key,
    version: z.number().int().positive(),
    careerId: CareerIdSchema,
    title: short,
    subtitle: short,
    occupationTitle: short,
    responsibilities: z.array(short).min(3).max(8),
    authority: z.array(short).min(1).max(8),
    assetManifestVersion: key,
    assetRefs: z.array(key).min(19).max(30),
    sources: z.array(GalgameSourceSchema).min(1).max(10),
    facts: z.array(GalgameFactSchema).min(3).max(20),
    characters: z.array(GalgameCharacterSchema).length(3),
    mentorId: NpcIdSchema,
    artifactFields: z
      .array(z.object({ id: key, label: short, hint: short }).strict())
      .min(4)
      .max(6),
    task: z.object({ id: key, title: short, brief: short }).strict(),
    promptVersion: key,
    domainReviewStatus: z.literal('pending'),
    synthetic: z.literal(true),
  })
  .strict()
export const GalgameChoiceSchema = z
  .object({
    id: key,
    label: z.string().trim().min(1).max(100),
    intent: z.enum(['investigate', 'clarify', 'request_review', 'handoff']),
  })
  .strict()
export const GalgameSceneSchema = z
  .object({
    id: key,
    title: short,
    background: z.enum(['office', 'meeting', 'testing', 'terrace']),
    narration: z.string().trim().min(1).max(1200),
    factIds: z.array(key).max(20),
  })
  .strict()
export const GalgameTaskSchema = z
  .object({ id: key, title: short, status: z.enum(['open', 'working', 'review', 'done']) })
  .strict()
export const GalgameArtifactSchema = z
  .object({
    id: key,
    taskId: key,
    fields: z.record(key, z.string().trim().min(8).max(2000)),
    submittedAtEventSeq: z.number().int().positive(),
    review: z
      .object({
        decision: z.enum(['accepted', 'revise']),
        feedback: z.string().trim().min(1).max(1200),
        reviewerId: NpcIdSchema,
        eventSeq: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict()
export const GalgameDebriefSchema = z
  .object({
    summary: z.string().trim().min(1).max(1500),
    observations: z
      .array(
        z
          .object({
            text: short,
            eventSeq: z.number().int().positive(),
            artifactId: key.optional(),
            sourceId: key,
          })
          .strict(),
      )
      .min(1)
      .max(5),
    nextSteps: z.array(short).min(1).max(5),
    interviewPractice: z.string().trim().min(1).max(1200),
  })
  .strict()
export const GalgameWorldStateSchema = z
  .object({
    phase: z.enum(['preparing', 'playing', 'ended']),
    minutes: z.number().int().min(0).max(180),
    scene: GalgameSceneSchema.nullable(),
    characters: z.array(GalgameCharacterSchema).length(3),
    choices: z.array(GalgameChoiceSchema).max(4),
    tasks: z.array(GalgameTaskSchema).length(1),
    artifacts: z.array(GalgameArtifactSchema).max(12),
    knowledge: z
      .object({
        player: z.array(key).max(20),
        lin: z.array(key).max(20),
        zhou: z.array(key).max(20),
        xu: z.array(key).max(20),
      })
      .strict(),
    memories: z
      .object({
        lin: z.array(z.object({ text: short, eventSeq: z.number().int().positive() }).strict()).max(8),
        zhou: z.array(z.object({ text: short, eventSeq: z.number().int().positive() }).strict()).max(8),
        xu: z.array(z.object({ text: short, eventSeq: z.number().int().positive() }).strict()).max(8),
      })
      .strict(),
    outcome: z.enum(['completed', 'handoff', 'stopped']).nullable(),
    debrief: GalgameDebriefSchema.nullable(),
  })
  .strict()
export const GalgameActionSchema = z
  .object({
    clientActionId: z.string().min(8).max(80),
    expectedRevision: z.number().int().nonnegative(),
    branchId: key,
    kind: z.enum(['begin', 'choice', 'act', 'message', 'submit_artifact', 'explain', 'leave', 'debrief']),
    channel: z.enum(['group', 'private']).default('group'),
    recipientId: NpcIdSchema.optional(),
    choiceId: key.optional(),
    text: z.string().trim().min(1).max(2000).optional(),
    artifact: z
      .object({ id: key, taskId: key, fields: z.record(key, z.string().trim().min(8).max(2000)) })
      .strict()
      .optional(),
    shareFactIds: z.array(key).max(20).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (['act', 'message'].includes(v.kind) && !v.text)
      ctx.addIssue({ code: 'custom', message: '请填写行动或对话。' })
    if (v.kind === 'choice' && !v.choiceId) ctx.addIssue({ code: 'custom', message: '请选择当前行动。' })
    if (v.kind === 'submit_artifact' && !v.artifact)
      ctx.addIssue({ code: 'custom', message: '请提交工作产物。' })
    if (v.channel === 'private' && (v.kind !== 'message' || !v.recipientId))
      ctx.addIssue({ code: 'custom', message: '私聊需要指定同事，工作行动在公开场景执行。' })
    if (v.channel === 'group' && v.recipientId)
      ctx.addIssue({ code: 'custom', message: '公开行动不能指定私聊收件人。' })
    if (v.kind !== 'submit_artifact' && v.artifact)
      ctx.addIssue({ code: 'custom', message: '这个动作不能携带产物。' })
    if (v.kind !== 'choice' && v.choiceId) ctx.addIssue({ code: 'custom', message: '这个动作不能携带选项。' })
    if (v.kind !== 'act' && v.shareFactIds?.length)
      ctx.addIssue({ code: 'custom', message: '分享资料需要公开行动。' })
  })
export const CreateGalgameSchema = z
  .object({
    mode: z.literal('galgame'),
    careerId: CareerIdSchema,
    player: PlayerProfileSchema,
    seed: z.string().min(1).max(80).optional(),
  })
  .strict()
export const GalgameTurnProposalSchema = z
  .object({
    scene: GalgameSceneSchema,
    eventType: z.enum(['briefing', 'investigation', 'collaboration', 'scope_change', 'review', 'handoff']),
    minutes: z.number().int().min(0).max(30),
    taskStatus: z.enum(['open', 'working', 'review', 'done']),
    choices: z.array(GalgameChoiceSchema).min(2).max(4),
    activeNpcIds: z.array(NpcIdSchema).min(1).max(2),
    goals: z.array(z.object({ characterId: NpcIdSchema, goal: short }).strict()).max(3),
  })
  .strict()
export const GalgameNpcResponseSchema = z
  .object({
    text: z.string().trim().min(1).max(1000),
    expression: z.enum(['neutral', 'relaxed', 'thinking', 'serious']),
    factIds: z.array(key).max(20),
    review: z
      .object({ decision: z.enum(['accepted', 'revise']), feedback: z.string().trim().min(1).max(1200) })
      .strict()
      .nullable(),
  })
  .strict()
export const GalgameGenerationSchema = z
  .object({
    director: GalgameTurnProposalSchema.optional(),
    npcs: z.array(z.object({ characterId: NpcIdSchema, response: GalgameNpcResponseSchema }).strict()).max(2),
    debrief: GalgameDebriefSchema.optional(),
  })
  .strict()
export const GalgameMessageSchema = z
  .object({
    id: key,
    eventSeq: z.number().int().positive(),
    speakerId: z.enum(['player', 'narrator', 'lin', 'zhou', 'xu']),
    text: z.string().max(4000),
    expression: z.enum(['neutral', 'relaxed', 'thinking', 'serious']),
    channel: z.enum(['group', 'private', 'explanation']),
    recipientId: NpcIdSchema.optional(),
    createdAt: z.string().datetime(),
    sourceEventIds: z.array(key).max(20),
  })
  .strict()
export const GalgameSessionDTOSchema = z
  .object({
    mode: z.literal('galgame'),
    id: key,
    title: short,
    branchId: key,
    revision: z.number().int().nonnegative(),
    eventSeq: z.number().int().nonnegative(),
    status: z.enum(['preparing', 'active', 'ended']),
    packId: key,
    packVersion: z.number().int().positive(),
    assetManifestVersion: key,
    careerId: CareerIdSchema,
    occupationTitle: short,
    player: PlayerProfileSchema,
    scene: GalgameSceneSchema.nullable(),
    choices: z.array(GalgameChoiceSchema).max(4),
    characters: z.array(GalgameCharacterSchema.omit({ goal: true })).length(3),
    tasks: z.array(GalgameTaskSchema).length(1),
    artifacts: z.array(GalgameArtifactSchema).max(12),
    minutes: z.number().int().nonnegative(),
    outcome: GalgameWorldStateSchema.shape.outcome,
    debrief: GalgameDebriefSchema.nullable(),
    sources: z.array(GalgameSourceSchema),
    facts: z.array(GalgameFactSchema.omit({ knownBy: true })),
    taskBrief: short,
    responsibilities: z.array(short),
    authority: z.array(short),
    artifactFields: GalgameDefinitionSchema.shape.artifactFields,
    messages: z.array(GalgameMessageSchema).max(60),
    hasMoreHistory: z.boolean(),
    branches: z
      .array(
        z
          .object({
            id: key,
            parentBranchId: key.nullable(),
            forkEventSeq: z.number().int().nonnegative(),
            revision: z.number().int().nonnegative(),
            label: short,
          })
          .strict(),
      )
      .max(50),
    beginActionId: key,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    provider: z.enum(['google', 'openai-compatible']),
  })
  .strict()
export type GalgameDefinition = z.infer<typeof GalgameDefinitionSchema>
export type GalgameWorldState = z.infer<typeof GalgameWorldStateSchema>
export type GalgameAction = z.infer<typeof GalgameActionSchema>
export type GalgameTurnProposal = z.infer<typeof GalgameTurnProposalSchema>
export type GalgameNpcResponse = z.infer<typeof GalgameNpcResponseSchema>
export type GalgameDebrief = z.infer<typeof GalgameDebriefSchema>
export type GalgameGeneration = z.infer<typeof GalgameGenerationSchema>
export type GalgameSessionDTO = z.infer<typeof GalgameSessionDTOSchema>
export type GalgameMessage = z.infer<typeof GalgameMessageSchema>
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>
export type NpcId = z.infer<typeof NpcIdSchema>
export type CareerId = z.infer<typeof CareerIdSchema>
