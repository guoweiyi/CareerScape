import { ContentPackSchema, type Choice, type ContentPack, type Effect, type EventTemplate, type NarrativeMessage, type StoryNode } from '../contracts'

const msg = (speakerId: NarrativeMessage['speakerId'], text: string, expression: NarrativeMessage['expression'] = 'neutral'): NarrativeMessage => ({ speakerId, text, expression })
const flag = (key: Extract<Effect, { op: 'set_flag' }>['key'], value = true): Effect => ({ op: 'set_flag', key, value })
const time = (minutes: number): Effect => ({ op: 'advance_time', minutes })
const task = (value: Extract<Effect, { op: 'set_task' }>['value']): Effect => ({ op: 'set_task', value })
const choice = (id: string, label: string, targetNodeId: string, effects: Effect[], messages: NarrativeMessage[], description = '', conditions: Choice['conditions'] = []): Choice => ({ id, label, targetNodeId, effects, messages, description, conditions })
const node = (nodeId: string, title: string, backgroundId: StoryNode['backgroundId'], messages: NarrativeMessage[], choices: Choice[], explanation: string, endingId?: 'verified' | 'scope' | 'handoff'): StoryNode => ({
  packId: 'qa-last-hour', packVersion: 1, nodeId, nodeType: endingId ? 'ending' : 'savepoint', title, contentRef: `qa-last-hour/1/${nodeId}`, conditions: [], effects: [], messages, choices,
  outgoingEdges: choices.map(item => ({ to: item.targetNodeId, choiceId: item.id, conditions: item.conditions })), roleVisibility: ['player', 'lin', 'zhou', 'xu'],
  assetRefs: [`bg_${backgroundId}_day_wide`], backgroundId, metadata: { checkpoint: true, explanation, ...(endingId ? { endingId } : {}) },
})

const nodes: StoryNode[] = [
  node('arrival', '17:00 · 一张还没勾完的清单', 'office', [
    msg('narrator', '窗边的绿植把影子投在工位上。你是栖木工作室刚入职的测试新人，桌面上是一款校园活动报名工具的发布清单。距团队约定的下班时间，还有一小时。'),
    msg('lin', '欢迎加入今天的验收。我们只看“报名确认”这条流程。现在不用懂全部技术；不确定就停下来问，测试结论由我复核。'),
    msg('zhou', '测试环境刚更新好了。我在隔壁，复现问题时叫我。', 'relaxed'),
  ], [
    choice('arrive_begin', '先了解今天要交付什么', 'briefing', [time(3)], [msg('lin', '好，先把目标和边界对齐。')]),
    choice('arrive_help', '我没做过测试，能带我开始吗', 'briefing', [flag('helpAsked'), time(3)], [msg('lin', '当然。今天你负责观察和记录，我陪你看第一遍。不会术语也能描述看到的事。', 'relaxed')]),
  ], '这是原创合成情境，不代表某家企业的制度。软件测试通常需要对比预期与实际行为；在这段故事里，你不负责独自批准上线。'),
  node('briefing', '先确认「应该发生什么」', 'meeting', [
    msg('xu', '今天的交付范围是：有剩余名额时可以报名，成功后只出现一条报名记录。导出名单暂时不在本次范围。'),
    msg('lin', '材料卡：测试账号“小禾”；测试活动剩余 1 个名额；操作“点击报名”；预期“显示成功，记录只有一条”。这些都是测试数据。'),
    msg('zhou', '昨天有人提过弱网下连续点击。我还没拿到完整步骤，不能先说已经修好了。', 'thinking'),
  ], [
    choice('brief_expected', '把成功条件写成一张检查卡', 'triage', [flag('reported'), time(5), task('triage')], [msg('lin', '已记下“只生成一条记录”。这会让后面的讨论有共同依据。')]),
    choice('brief_product', '请许知确认重复报名的影响', 'triage', [flag('askedProduct'), time(5), task('triage'), { op: 'reveal', characterId: 'lin', factId: 'duplicate-impact' }], [msg('xu', '如果重复占名额，后来的同学可能报不上。我们需要先确认是否真的产生了两条记录，再决定本次范围。', 'serious')]),
    choice('brief_help', '请林澄演示一遍正常流程', 'triage', [flag('helpAsked'), time(5), task('triage')], [msg('lin', '我用测试账号点一次，保存成功页面和记录列表。你可以照着做；别用真实同学的数据。', 'relaxed')]),
  ], '预期行为、实际行为、环境和复现步骤是一张缺陷记录的重要信息。本情境用材料卡代替真实系统操作，不声称已执行真实软件测试。'),
  node('triage', '同一句「成功」，出现了两次', 'testing', [
    msg('narrator', '模拟材料：切换为弱网后，你连续点了两次报名。页面出现两条“报名成功”，记录列表也显示了两条相同的测试报名。'),
    msg('zhou', '两个提示不一定等于两条数据。现在材料里记录也重复了，这个线索有用。可以告诉我发生顺序吗？', 'thinking'),
    msg('lin', '我们有三种合理安排：一起复现并验证修复；和产品谈缩小本次范围；整理证据，交给接班同事。你可以选适合自己的边界。'),
  ], [
    choice('triage_verify', '和周砚一起复现，再验证修复', 'work', [flag('bugReproduced'), time(12), task('investigating'), { op: 'reveal', characterId: 'zhou', factId: 'duplicate-observed' }], [msg('zhou', '收到步骤：弱网、剩余一个名额、连续点击两次、出现两条记录。我先检查重复请求的处理，你保留原始材料。')], '尝试验证路线；不需要编程。'),
    choice('triage_scope', '请许知协商本次先不开放报名', 'work', [flag('scopeReduced'), time(10), task('investigating'), { op: 'reveal', characterId: 'xu', factId: 'duplicate-observed' }], [msg('xu', '可以讨论把报名入口暂时关闭，让活动介绍页先发布。我会明确这需要产品确认，并通知受影响的人。', 'thinking')], '范围协商路线；缩小范围也需要验证。'),
    choice('triage_handoff', '今天先不继续排查，整理交接', 'work', [flag('handoffReady'), time(7), task('deferred')], [msg('lin', '可以。把已知、未知和下一步分开写，团队接住后续工作。你不需要为了证明投入而延长工作时间。')], '交接路线；不扣分，也不判断职业适配。'),
    choice('triage_help', '我分不清这些信息，想有人一起看', 'work', [flag('helpAsked'), flag('bugReproduced'), time(12), task('investigating')], [msg('lin', '我陪你把观察整理成四行：环境、步骤、预期、实际。然后请周砚一起复现。', 'relaxed')]),
  ], '缺陷严重程度、发布优先级和个人能力是不同的事。这里没有能力分数。你看到的是合成材料，不是行业统一的优先级判定。'),
  node('work', '把计划变成可以交接的证据', 'testing', [
    msg('lin', '现在留下一份可核对的结果。选择和刚才的安排对应的检查；如果想改变安排，也可以重新协商。', 'thinking'),
    msg('narrator', '材料卡：A 修复候选在测试环境等待验证；B 关闭报名入口的候选方案等待确认；C 原始截图、复现步骤和“尚未验证”标记可组成交接单。'),
  ], [
    choice('work_verify', '检查修复：正常点击与连续点击都只保留一条', 'decision', [flag('verified'), flag('handoffReady'), time(18), task('ready'), { op: 'resolve', issue: '重复报名待确认' }], [msg('narrator', '模拟验证结果：正常点击、弱网下连续点击两组材料均只出现一条记录。你把环境、测试数据和结果写入清单。'), msg('zhou', '谢谢你补了正常路径。现在结论是“这些检查通过”，不是“系统不可能再有问题”。', 'relaxed')], '记录明确的验证范围。', [{ op: 'flag', key: 'bugReproduced', equals: true }]),
    choice('work_scope', '确认缩小范围，并检查关闭入口后的提示', 'decision', [flag('scopeReduced'), flag('handoffReady'), time(12), task('ready'), { op: 'resolve', issue: '重复报名待确认' }], [msg('xu', '我确认本次只发布活动介绍页，报名稍后开放。提示文案会说明开放时间另行通知。', 'serious'), msg('lin', '模拟检查：报名入口已关闭，页面没有误导性的“可以报名”。重复报名问题仍留在后续清单。')], '产品确认范围；测试确认当前表现。'),
    choice('work_handoff', '记录尚未验证，把问题和下一步交出去', 'decision', [flag('handoffReady'), time(8), task('deferred')], [msg('lin', '交接单已整理：重复报名材料、环境、未验证修复、下一步负责人。未解决不等于你的失职，我们按真实状态记录。')]),
    choice('work_help', '请林澄和我共同核对交接单', 'decision', [flag('helpAsked'), flag('handoffReady'), time(8), task('deferred')], [msg('lin', '我们一起核对。你提供的观察很具体，我补上复核人和后续时间；今天不强求你独立完成。', 'relaxed')]),
  ], '回归验证要关注修复是否达到预期，以及相关正常路径是否受到影响。范围调整不等于缺陷消失；“未验证”应继续明确标记。'),
  node('decision', '最后一条消息，怎么写', 'meeting', [
    msg('xu', '请把今天真正完成的事说清楚。发布决定和对外说明由我负责，测试结论由林澄复核。'),
    msg('lin', '你可以交付有限范围的验证结果、确认缩小后的方案，或者按当前状态交接下班。剩下的问题会有人接着处理。', 'relaxed'),
  ], [
    choice('finish_verified', '提交已验证清单，正常下班', 'ending-verified', [time(5), task('done'), { op: 'relation', characterId: 'zhou', label: '约定用复现材料协作' }], [msg('lin', '我已复核清单。你的结论有范围、有证据；今天到这里。', 'relaxed')], '验证交付结局', [{ op: 'flag', key: 'verified', equals: true }]),
    choice('finish_scope', '确认缩小范围，留下后续待办', 'ending-scope', [time(5), task('done'), { op: 'relation', characterId: 'xu', label: '约定明确变更范围' }], [msg('xu', '范围和对外说明由我承接。我们交付今天达成共识的内容，报名问题继续追踪。', 'relaxed')], '协商范围结局', [{ op: 'flag', key: 'scopeReduced', equals: true }]),
    choice('finish_handoff', '交接未完成事项，结束今天体验', 'ending-handoff', [time(3), task('deferred'), flag('handoffReady')], [msg('lin', '交接收到了。我会安排后续，你现在可以下班。', 'relaxed')], '交接下班结局'),
  ], '发布、质量复核和执行检查可以由不同职责承担。本虚构团队的权限分工只适用于这个故事，不是所有软件团队的标准。'),
  node('ending-verified', '下班了 · 一份有边界的结论', 'terrace', [
    msg('narrator', '你提交了两组模拟验证材料，林澄复核后交给许知。清单上没有“绝对没问题”，只有可复查的范围与结果。'),
    msg('zhou', '下次有类似现象，我们还是先交换复现材料。辛苦了，明天见。', 'relaxed'),
    msg('lin', '今天的手账写不写都可以。你也可以保留一个问题：我喜欢这种把不确定的事查清楚的过程吗？', 'relaxed'),
  ], [], '验证交付：你体验了观察、复现、有限范围验证和说明结论。这不构成职业能力评价。', 'verified'),
  node('ending-scope', '下班了 · 让承诺与现实相遇', 'terrace', [
    msg('narrator', '活动介绍页按缩小后的范围推进，报名入口仍关闭。缺陷留在明确的后续清单里，没有被一条“先上线再说”掩盖。'),
    msg('xu', '谢谢你把风险说具体。对外解释这次范围是我的职责，明天我们再安排剩下的事。', 'relaxed'),
    msg('narrator', '如果愿意，可以记下协商时最在意的一点；不喜欢这种工作方式也可以，不必得出结论。'),
  ], [], '协商范围：你体验了把问题影响与交付承诺放在一起讨论。缩小范围不是自动的好或坏，关键是透明确认。', 'scope'),
  node('ending-handoff', '下班了 · 问题留下，人可以休息', 'terrace', [
    msg('narrator', '交接单写着已知现象、尚未完成的验证和下一位接手的人。未解决事项被保留下来，你没有用一句“应该没事”替代证据。'),
    msg('lin', '交接不是把麻烦丢给别人，是让工作可以连续。剩下的由团队安排，你不需要现在继续。', 'relaxed'),
    msg('narrator', '你可以关闭页面、看看另一条分支，或写一行私人手账。没有必须完成的复盘。'),
  ], [], '交接下班：清晰记录未知和边界也是工作的一部分。选择离开不降低分数，这里也不存在职业适配分数。', 'handoff'),
]

const event = (id: string, kind: EventTemplate['kind'], slot: EventTemplate['slot'], roles: EventTemplate['roles'], text: string, extra: Partial<EventTemplate> = {}): EventTemplate => ({ id, version: 1, profileId: 'qa-junior', profileVersion: 1, kind, slot, roles, conditions: [], revealFactIds: [], actions: nodes.find(item => item.nodeId === slot)?.choices.map(item => item.id) ?? ['leave'], messages: [msg(roles[0] ?? 'narrator', text)], mutexGroup: `${slot}-flavor`, cooldownTurns: 0, weight: 1, sourceFactIds: [], origin: 'synthetic', contentStatus: 'published', domainReviewStatus: 'pending', batchId: 'synthetic-seed-20261008', ...extra })
const events = [
  event('daily-window', 'daily', 'arrival', ['lin'], '窗边的位置光线比较好。先把水杯放好，我们从一条小流程开始。'),
  event('daily-checklist', 'daily', 'arrival', ['zhou'], '我把今天的版本号贴在测试材料上了，免得我们看的是不同版本。'),
  event('learn-expectation', 'learning', 'briefing', ['lin'], '先说“应该发生什么”，再说“实际看到了什么”。这两句已经很有价值。'),
  event('collab-boundary', 'collaboration', 'briefing', ['xu'], '“介绍页发布”和“报名开放”是两项承诺，我们可以分别讨论。'),
  event('triage-evidence', 'triage', 'triage', ['zhou'], '你保留的记录列表能帮助排除“只是重复提示”的猜测。'),
  event('triage-help', 'help', 'triage', ['lin'], '不确定哪个现象重要时，把观察原样留下来，我们一起判断。'),
  event('work-pair', 'help', 'work', ['lin', 'zhou'], '我陪你核对复现材料，周砚确认技术处理。求助不需要先证明自己已经试够久。'),
  event('work-context', 'learning', 'work', ['zhou'], '确认使用同一版测试材料后，我们再比较修复前后的结果。'),
  event('work-recognition', 'recognition', 'work', ['lin'], '你把“尚未验证”写得很清楚，这能避免下一位接手的人误会。'),
  event('decision-accept', 'success', 'decision', ['xu'], '我们已经有足够具体的信息来决定今天的范围，不需要谁独自兜底。'),
  event('decision-boundary', 'boundary', 'decision', ['lin'], '离下班不远了。你可以把边界和后续安排写清楚，不必临时延长自己的承诺。'),
  event('ending-rest', 'handoff', 'ending', ['lin'], '今天先到这里。未完事项有人承接，人也需要休息。'),
  event('ending-thanks', 'recognition', 'ending', ['zhou'], '谢谢你的清楚记录；下次合作可以从这些证据继续。'),
  event('work-verified-detail', 'success', 'work', ['zhou'], '这一条检查已经通过，结果仍然只对记录中的环境和范围负责。', { conditions: [{ op: 'flag', key: 'verified', equals: true }] }),
]

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child) }
  return value
}

export const legacyPack: ContentPack = deepFreeze(ContentPackSchema.parse({
  id: 'qa-last-hour', version: 1, title: '上线前的最后一小时', subtitle: '软件测试新人 · 原创合成演示', occupationId: 'qa-junior', organization: '栖木工作室', origin: 'synthetic', contentStatus: 'published', domainReviewStatus: 'pending', releasePolicy: 'demo',
  datasetVersion: 'qa-demo-2026-10-08', contentBuildId: 'qa-last-hour-v1', profileVersion: 1, assetManifestVersion: 'careerscape-art-v1', schemaVersion: 1, samplerVersion: 'constrained-v1', promptVersion: 'npc-bounded-v1',
  profile: { id: 'qa-junior', title: '软件测试新人', scope: '虚构小型产品团队中的功能验收协作', level: '入门协作', responsibilities: ['对照材料观察预期与实际', '记录复现步骤和测试条件', '说明验证边界并交接'], authority: ['可记录与提问', '可求助、拒绝额外工作和下班', '不可自行批准发布或改写需求'], collaborators: ['资深 QA 林澄', '开发 周砚', '产品 许知'], prerequisites: ['无需编程基础', '材料卡提供所需情境信息'], workingHours: '故事 17:00 开始，团队约定 18:00 下班；不鼓励超时', unknownFacts: ['不代表真实公司的岗位职责、薪资或作息', '未进行行业专家核验', '不涉及真实系统和真实用户数据'] },
  characters: [
    { id: 'lin', name: '林澄', role: '资深 QA', roleSlot: 'mentor', age: 29, personality: '说话简洁，喜欢先确认事实；会给新人留出提问空间，也会坦承自己需要复核。', goal: '让测试结论可复查，让团队明确承接未完事项。', permissions: ['复核测试结论', '组织结对检查', '安排交接'], initialKnowledge: ['team-boundary', 'acceptance-criteria'], appearance: '成年女性，低马尾，奶油色衬衣，绿色马甲；平静、轻松、思考、严肃四种表情固定服装与身份。', assetRefs: ['chr_lin_work_half_neutral', 'chr_lin_work_half_relaxed', 'chr_lin_work_half_thinking', 'chr_lin_work_half_serious', 'avatar_lin_neutral'], sourceFactIds: [], origin: 'synthetic' },
    { id: 'zhou', name: '周砚', role: '产品开发', roleSlot: 'developer', age: 27, personality: '爱把猜测和证据分开；忙的时候句子短，拿到清晰信息后会主动配合。', goal: '确认重复报名的触发条件，给出可验证的修复候选。', permissions: ['修改测试环境中的候选代码', '说明技术状态'], initialKnowledge: ['team-boundary', 'build-candidate'], appearance: '成年男性，短黑发，深蓝工装衬衣；不以严肃表情暗示敌意。', assetRefs: ['chr_zhou_work_half_neutral', 'chr_zhou_work_half_relaxed', 'chr_zhou_work_half_thinking', 'chr_zhou_work_half_serious', 'avatar_zhou_neutral'], sourceFactIds: [], origin: 'synthetic' },
    { id: 'xu', name: '许知', role: '产品负责人', roleSlot: 'product', age: 28, personality: '在意承诺是否被理解；愿意协商范围，需要具体影响来作决定。', goal: '把对外承诺与已验证的范围对齐，而不是催所有人无限加班。', permissions: ['确认本次交付范围', '负责发布决定和对外说明'], initialKnowledge: ['team-boundary', 'acceptance-criteria', 'duplicate-impact', 'product-note'], appearance: '成年女性，齐肩深棕发，赤陶色开衫；服装和脸部身份在表情间保持固定。', assetRefs: ['chr_xu_work_half_neutral', 'chr_xu_work_half_relaxed', 'chr_xu_work_half_thinking', 'chr_xu_work_half_serious', 'avatar_xu_neutral'], sourceFactIds: [], origin: 'synthetic' },
  ],
  project: { id: 'campus-registration', title: '校园活动报名工具的小版本发布', deliverables: ['一份有范围的验证清单，或范围变更记录，或未完成事项交接单'], resources: ['脱敏合成测试账号', '正常与弱网模拟材料', '复现记录卡'], deadline: '今天 18:00 前确认交付或交接安排', approver: 'xu', exitPath: '任何阶段可以整理当前已知后下班；团队接手剩余事项' },
  sources: [{ id: 'source-synthetic-design', url: null, title: 'CareerScape 原创合成情境设计', observedAt: '2026-10-08T00:00:00.000Z', publishedAt: null, scope: '只支持本包虚构组织、任务与人物设定；不作为行业统计来源', rights: { read: true, store: true, embed: false, train: false, redistribute: true }, origin: 'synthetic', reviewStatus: 'agent_checked' }],
  facts: [
    { id: 'team-boundary', text: '这个虚构团队约定 18:00 下班，未完成工作通过交接延续。', audience: ['lin', 'zhou', 'xu'] },
    { id: 'acceptance-criteria', text: '本次目标：可报名时成功生成且只生成一条报名记录。', audience: ['lin', 'xu'] },
    { id: 'build-candidate', text: '当前测试环境已经更新，但重复报名问题尚未完成验证。', audience: ['zhou'] },
    { id: 'duplicate-impact', text: '若重复占名额，后续报名可能受到影响，需要确认实际记录。', audience: ['xu'] },
    { id: 'duplicate-observed', text: '合成材料中：弱网连续点击两次后出现了两条相同的测试报名记录。', audience: [] },
    { id: 'product-note', text: '产品视角材料：活动介绍页与报名入口可以分开发布；对外时间承诺尚待确认。', audience: ['xu'] },
  ].map(item => ({ ...item, sourceId: 'source-synthetic-design', kind: 'fictional_scenario' })),
  nodes, startNodeId: 'arrival', events,
  assetRefs: ['lin', 'zhou', 'xu'].flatMap(id => [...['neutral', 'relaxed', 'thinking', 'serious'].map(expression => `chr_${id}_work_half_${expression}`), `avatar_${id}_neutral`]).concat(['bg_office_day_wide', 'bg_meeting_day_wide', 'bg_testing_day_wide', 'bg_terrace_day_wide']),
  review: { reviewerType: 'agent', scope: ['字段与引用校验', '三条路径与退出路径测试', '角色职责和权限一致性', '虚构来源边界说明'], limitations: ['没有行业人工审核', '仅三名主角色，人物组合固定', 'AI 对话质量需真实 provider 回归', '美术文件与许可由独立资源发布门禁验证'], reviewedAt: '2026-10-08T00:00:00.000Z' },
}))

