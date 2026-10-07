import { z } from 'zod'

export const CharacterIdSchema = z.enum(['lin', 'zhou', 'xu'])
export type CharacterId = z.infer<typeof CharacterIdSchema>
export const FlagSchema = z.enum(['helpAsked', 'bugReproduced', 'verified', 'scopeReduced', 'handoffReady', 'askedProduct', 'roleSwitched', 'reported'])
export const TaskStatusSchema = z.enum(['orientation', 'triage', 'investigating', 'ready', 'done', 'deferred'])
export const ConditionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('flag'), key: FlagSchema, equals: z.boolean() }).strict(),
  z.object({ op: z.literal('time_before'), minute: z.number().int().min(0).max(120) }).strict(),
  z.object({ op: z.literal('task_is'), value: TaskStatusSchema }).strict(),
  z.object({ op: z.literal('knows'), characterId: CharacterIdSchema, factId: z.string().min(1).max(80) }).strict(),
])
export type Condition = z.infer<typeof ConditionSchema>
export const EffectSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_flag'), key: FlagSchema, value: z.boolean() }).strict(),
  z.object({ op: z.literal('advance_time'), minutes: z.number().int().min(0).max(60) }).strict(),
  z.object({ op: z.literal('set_task'), value: TaskStatusSchema }).strict(),
  z.object({ op: z.literal('reveal'), characterId: CharacterIdSchema, factId: z.string().min(1).max(80) }).strict(),
  z.object({ op: z.literal('relation'), characterId: CharacterIdSchema, label: z.string().min(1).max(60) }).strict(),
  z.object({ op: z.literal('resolve'), issue: z.string().min(1).max(80) }).strict(),
])
export type Effect = z.infer<typeof EffectSchema>
export const NarrativeMessageSchema = z.object({ speakerId: z.enum(['lin', 'zhou', 'xu', 'narrator']), text: z.string().min(1).max(3000), expression: z.enum(['neutral', 'relaxed', 'thinking', 'serious']).default('neutral') }).strict()
export type NarrativeMessage = z.infer<typeof NarrativeMessageSchema>
export const ChoiceSchema = z.object({ id: z.string().min(1).max(80), label: z.string().min(1).max(140), description: z.string().max(300).default(''), targetNodeId: z.string().min(1), conditions: z.array(ConditionSchema).max(10), effects: z.array(EffectSchema).max(12), messages: z.array(NarrativeMessageSchema).max(5) }).strict()
export type Choice = z.infer<typeof ChoiceSchema>
export const StoryNodeSchema = z.object({
  packId: z.string(), packVersion: z.number().int().positive(), nodeId: z.string().min(1), nodeType: z.enum(['scene', 'dialogue', 'choice', 'savepoint', 'ending']),
  title: z.string().min(1).max(100), contentRef: z.string(), conditions: z.array(ConditionSchema), effects: z.array(EffectSchema),
  messages: z.array(NarrativeMessageSchema).min(1).max(8), choices: z.array(ChoiceSchema).max(8), outgoingEdges: z.array(z.object({ to: z.string(), choiceId: z.string(), conditions: z.array(ConditionSchema) }).strict()),
  roleVisibility: z.array(z.enum(['player', 'lin', 'zhou', 'xu'])), assetRefs: z.array(z.string()), backgroundId: z.enum(['office', 'meeting', 'testing', 'terrace']),
  metadata: z.object({ checkpoint: z.boolean(), explanation: z.string().max(3000), endingId: z.enum(['verified', 'scope', 'handoff']).optional() }).strict(),
}).strict()
export type StoryNode = z.infer<typeof StoryNodeSchema>
export const WorldStateSchema = z.object({
  nodeId: z.string(), minute: z.number().int().min(0).max(180), flags: z.record(FlagSchema, z.boolean()),
  knowledge: z.object({ lin: z.array(z.string()), zhou: z.array(z.string()), xu: z.array(z.string()) }).strict(),
  relations: z.object({ lin: z.array(z.string()), zhou: z.array(z.string()), xu: z.array(z.string()) }).strict(),
  unresolved: z.array(z.string()), taskStatus: TaskStatusSchema, perspective: z.enum(['qa', 'product']).default('qa'), endingId: z.enum(['verified', 'scope', 'handoff']).optional(),
}).strict()
export type WorldState = z.infer<typeof WorldStateSchema>
export const CharacterSchema = z.object({ id: CharacterIdSchema, name: z.string(), role: z.string(), roleSlot: z.enum(['mentor', 'developer', 'product']), age: z.number().int().min(18), personality: z.string(), goal: z.string(), permissions: z.array(z.string()), initialKnowledge: z.array(z.string()), appearance: z.string(), assetRefs: z.array(z.string()).min(5), sourceFactIds: z.array(z.string()), origin: z.literal('synthetic') }).strict()
export type Character = z.infer<typeof CharacterSchema>
export const EventTemplateSchema = z.object({ id: z.string(), version: z.number().int().positive(), profileId: z.literal('qa-junior'), profileVersion: z.number().int().positive(), kind: z.enum(['daily', 'success', 'recognition', 'learning', 'help', 'boundary', 'handoff', 'triage', 'collaboration']), slot: z.enum(['arrival', 'briefing', 'triage', 'work', 'decision', 'ending']), roles: z.array(CharacterIdSchema), conditions: z.array(ConditionSchema), revealFactIds: z.array(z.string()), actions: z.array(z.string()), messages: z.array(NarrativeMessageSchema).min(1), mutexGroup: z.string().nullable(), cooldownTurns: z.number().int().nonnegative(), weight: z.number().positive(), sourceFactIds: z.array(z.string()), origin: z.literal('synthetic'), contentStatus: z.enum(['draft', 'auto_checked', 'approved', 'published', 'withdrawn']), domainReviewStatus: z.enum(['not_required', 'pending', 'verified', 'rejected']), batchId: z.string() }).strict()
export type EventTemplate = z.infer<typeof EventTemplateSchema>
export const SourceSchema = z.object({ id: z.string(), url: z.string().url().nullable(), title: z.string(), observedAt: z.string().datetime(), publishedAt: z.string().datetime().nullable(), scope: z.string(), rights: z.object({ read: z.boolean(), store: z.boolean(), embed: z.boolean(), train: z.boolean(), redistribute: z.boolean() }).strict(), origin: z.literal('synthetic'), reviewStatus: z.literal('agent_checked') }).strict()
export const ContentPackSchema = z.object({
  id: z.string(), version: z.number().int().positive(), title: z.string(), subtitle: z.string(), occupationId: z.literal('qa-junior'), organization: z.literal('栖木工作室'), origin: z.literal('synthetic'),
  contentStatus: z.enum(['draft', 'auto_checked', 'approved', 'published', 'withdrawn']), domainReviewStatus: z.enum(['pending', 'verified', 'rejected']), releasePolicy: z.enum(['demo', 'industry']),
  datasetVersion: z.string(), contentBuildId: z.string(), profileVersion: z.number().int().positive(), assetManifestVersion: z.string(), schemaVersion: z.literal(1), samplerVersion: z.literal('constrained-v1'), promptVersion: z.string(),
  profile: z.object({ id: z.literal('qa-junior'), title: z.string(), scope: z.string(), level: z.string(), responsibilities: z.array(z.string()), authority: z.array(z.string()), collaborators: z.array(z.string()), prerequisites: z.array(z.string()), workingHours: z.string(), unknownFacts: z.array(z.string()) }).strict(),
  characters: z.array(CharacterSchema).length(3), project: z.object({ id: z.string(), title: z.string(), deliverables: z.array(z.string()), resources: z.array(z.string()), deadline: z.string(), approver: CharacterIdSchema, exitPath: z.string() }).strict(),
  sources: z.array(SourceSchema).min(1), facts: z.array(z.object({ id: z.string(), sourceId: z.string(), text: z.string(), audience: z.array(CharacterIdSchema), kind: z.literal('fictional_scenario') }).strict()),
  nodes: z.array(StoryNodeSchema).min(6).max(8), startNodeId: z.string(), events: z.array(EventTemplateSchema).min(12), assetRefs: z.array(z.string()).min(19),
  review: z.object({ reviewerType: z.enum(['agent', 'human']), scope: z.array(z.string()), limitations: z.array(z.string()), reviewedAt: z.string().datetime() }).strict(),
}).strict()
export type ContentPack = z.infer<typeof ContentPackSchema>
export const GameInstanceSchema = z.object({ instanceId: z.string(), packId: z.string(), packVersion: z.number(), datasetVersion: z.string(), contentBuildId: z.string(), profileVersion: z.number(), assetManifestVersion: z.string(), schemaVersion: z.literal(1), samplerVersion: z.literal('constrained-v1'), seed: z.string(), castMapping: z.object({ mentor: z.literal('lin'), developer: z.literal('zhou'), product: z.literal('xu') }).strict(), projectMapping: z.string(), eventPool: z.array(z.string()), slotMapping: z.record(z.string(), z.string()), fallback: z.boolean() }).strict()
export type GameInstance = z.infer<typeof GameInstanceSchema>
export const ActionInputSchema = z.object({ clientActionId: z.string().min(8).max(80), expectedRevision: z.number().int().nonnegative(), branchId: z.string().min(1).max(100), kind: z.enum(['choice', 'message', 'explain', 'leave', 'switch_role']), choiceId: z.string().max(80).optional(), text: z.string().min(1).max(2000).optional(), channel: z.enum(['group', 'private']), recipientId: CharacterIdSchema.optional() }).strict().superRefine((input, context) => {
  if (input.kind === 'choice' && !input.choiceId) context.addIssue({ code: 'custom', path: ['choiceId'], message: '请选择行动' })
  if (input.kind === 'message' && !input.text?.trim()) context.addIssue({ code: 'custom', path: ['text'], message: '请输入消息' })
  if (input.channel === 'private' && !input.recipientId) context.addIssue({ code: 'custom', path: ['recipientId'], message: '私聊需要收件人' })
})
export type ActionInput = z.infer<typeof ActionInputSchema>
export * from './protocol'
