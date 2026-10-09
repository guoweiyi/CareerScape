import { GalgameDefinitionSchema, type CareerId, type GalgameDefinition } from '../contracts/galgame'
import { demoPack } from './seed'

const source = (
  id: string,
  title: string,
  url: string,
  publisher: string,
  scope: string,
  summary: string,
) => ({
  id,
  title,
  url,
  publisher,
  scope,
  summary,
  consultedAt: '2026-10-09',
  rights: 'citation-and-original-summary' as const,
})
const characters = [
  {
    id: 'lin' as const,
    name: '林澄',
    role: '测试工程师',
    goal: '让证据清楚、风险可沟通，帮助新人建立工作边界。',
    expression: 'neutral' as const,
  },
  {
    id: 'zhou' as const,
    name: '周砚',
    role: '前端工程师',
    goal: '理解问题后提出可验收的修改方案，避免未经验证的承诺。',
    expression: 'neutral' as const,
  },
  {
    id: 'xu' as const,
    name: '许知',
    role: '产品经理',
    goal: '澄清用户目标、交付范围和优先级，协调团队的不同意见。',
    expression: 'neutral' as const,
  },
]
const base = {
  mode: 'galgame' as const,
  schemaVersion: 1 as const,
  version: 1,
  assetManifestVersion: demoPack.assetManifestVersion,
  assetRefs: [...demoPack.assetRefs],
  characters,
  promptVersion: 'career-galgame-v1',
  domainReviewStatus: 'pending' as const,
  synthetic: true as const,
}
const publicFact = (id: string, text: string) => ({
  id,
  text,
  origin: 'fictional-case' as const,
  knownBy: ['player', 'lin', 'zhou', 'xu'] as const,
})
const fixtures: Record<CareerId, unknown> = {
  qa: {
    ...base,
    id: 'gal-qa-day',
    careerId: 'qa',
    occupationTitle: '软件测试',
    title: '上线前，先把证据拼完整',
    subtitle: '一份缺陷报告，一次风险沟通，和愿意一起确认的同事。',
    mentorId: 'lin',
    responsibilities: [
      '对比预期和实际行为，设计与执行测试。',
      '记录可复现的问题及相关环境、步骤和证据。',
      '向开发和产品沟通风险，复核修改后的行为。',
    ],
    authority: ['可以调查、记录、提出风险和请求复核。', '新人不能独自批准发布；需要导师和负责人确认。'],
    sources: [
      source(
        'onet-qa',
        'Software Quality Assurance Analysts and Testers',
        'https://www.onetonline.org/link/summary/15-1253.00',
        'O*NET OnLine',
        '美国职业任务描述，参考软件测试工作流程；不推断中国资格、薪资或招聘要求。',
        '测试工作包括识别并记录软件功能问题、设计测试计划与场景、分析测试结果及与团队协作。',
      ),
    ],
    facts: [
      publicFact('project', '栖木工作室的虚构校园活动工具正在准备发布；本局使用合成测试材料。'),
      publicFact('expected', '测试活动剩余一个名额；一次报名预期只有一条有效记录。'),
      publicFact('observed', '材料记录：弱网下连续点击两次报名，列表出现两条相同测试记录。'),
      publicFact('environment', '合成材料环境：测试环境 v0.8，Chrome，弱网模式；账号 test-xiaohe。'),
      publicFact('boundary', '本局没有连接真实测试系统；结论应说明材料依据和未验证事项。'),
      {
        id: 'dev-clue',
        text: '周砚在合成日志里看到两次相同 request-key 的请求；这只是定位线索，原因尚未验证。',
        origin: 'fictional-case',
        knownBy: ['zhou'],
      },
    ],
    artifactFields: [
      { id: 'environment', label: '环境与对象', hint: '写明环境、版本、账号和测试对象。' },
      { id: 'steps', label: '复现步骤', hint: '让接手同事能按顺序重现观察。' },
      { id: 'expected', label: '预期结果', hint: '引用已经确认的成功条件。' },
      { id: 'observed', label: '实际结果与证据', hint: '描述材料中的实际行为及依据。' },
      { id: 'risk', label: '风险与未验证事项', hint: '区分已知、推测和下一步验证。' },
    ],
    task: {
      id: 'deliverable',
      title: '提交可复核的缺陷与风险记录',
      brief: '先了解材料，与同事澄清，再整理缺陷报告，请林澄复核。',
    },
  },
  frontend: {
    ...base,
    id: 'gal-frontend-day',
    careerId: 'frontend',
    occupationTitle: '前端开发',
    title: '一个报名按钮，几种真实的顾虑',
    subtitle: '把接口、交互和可访问性放到同一张验收清单上。',
    mentorId: 'zhou',
    responsibilities: [
      '实现页面与交互，对接约定的接口。',
      '定位异常，考虑响应式、可访问性与错误反馈。',
      '通过版本协作、审阅和测试确认修改。',
    ],
    authority: ['可以提出和提交修改方案，请同事审阅。', '新人不能独自更改后端契约或部署生产环境。'],
    sources: [
      source(
        'mdn-frontend',
        'MDN Curriculum',
        'https://developer.mozilla.org/en-US/curriculum/',
        'Mozilla / MDN',
        '前端能力与实践参考，具体团队技术栈和分工因企业而异。',
        '前端基础包含 HTML、CSS、JavaScript、可访问性、响应式设计、版本控制、性能及测试。',
      ),
    ],
    facts: [
      publicFact('project', '栖木工作室正在改进虚构校园活动报名页，本局只使用合成接口与观察材料。'),
      publicFact('contract', '约定接口：POST /registrations，重复报名返回 409；成功返回 registrationId。'),
      publicFact('observed', '合成观察：弱网重复点击会发送两个请求；409 时页面仍显示成功提示。'),
      publicFact('accessibility', '合成观察：按钮没有清晰的焦点样式，提交失败后屏幕阅读器没有状态提示。'),
      publicFact(
        'boundary',
        '本局可以提交代码片段和方案，但没有代码运行环境；不能声称自动测试或部署已经通过。',
      ),
      {
        id: 'dev-clue',
        text: '周砚查看合成片段后发现 finally 中的成功提示覆盖了 catch 的错误提示；这项观察尚未经过运行验证。',
        origin: 'fictional-case',
        knownBy: ['zhou'],
      },
    ],
    artifactFields: [
      { id: 'issue', label: '问题与复现条件', hint: '描述用户行为、接口结果和界面表现。' },
      { id: 'analysis', label: '定位依据', hint: '区分观察到的事实与原因假设。' },
      { id: 'solution', label: '修改方案或代码片段', hint: '说明加载状态、重复请求、错误和焦点反馈的处理。' },
      {
        id: 'verification',
        label: '验收与待验证清单',
        hint: '列出成功、409、弱网、键盘和屏幕阅读器场景；注明尚未运行。',
      },
    ],
    task: {
      id: 'deliverable',
      title: '提交报名交互的修复与验收方案',
      brief: '与测试和产品确认问题，提出有边界的方案，请周砚审阅。',
    },
  },
  product: {
    ...base,
    id: 'gal-product-day',
    careerId: 'product',
    occupationTitle: '产品工作',
    title: '今天上线什么，为什么',
    subtitle: '面对不同的声音，做一次有依据的范围取舍。',
    mentorId: 'xu',
    responsibilities: [
      '理解用户问题，澄清产品目标与成功条件。',
      '整理需求并解释优先级和范围取舍。',
      '与设计、开发和测试协作，对齐交付与验收。',
    ],
    authority: [
      '可以访谈、整理需求、提出优先级和验收建议。',
      '新人不能独自承诺排期、批准发布或替负责人做最终决定。',
    ],
    sources: [
      source(
        'atlassian-product',
        'Product manager: role and responsibilities',
        'https://www.atlassian.com/agile/product-management/product-manager',
        'Atlassian',
        '软件团队产品管理实践参考；产品经理与 Product Owner 的职责不直接等同。',
        '产品经理理解用户需要，明确产品方向、协调利益相关方，并推动团队围绕目标做优先级取舍。',
      ),
    ],
    facts: [
      publicFact('project', '栖木工作室的虚构校园活动工具计划先发布活动介绍和报名流程。'),
      publicFact('goal', '合成用户访谈：学生希望知道报名是否成功，组织者希望避免名额被重复占用。'),
      publicFact('capacity', '合成排期材料：当天只剩两小时协作时间，新增名单导出预计需要额外两天。'),
      publicFact('risk', '测试材料显示弱网重复报名可能产生两条记录，修复与影响尚未确认。'),
      publicFact('boundary', '本局需求和排期都是合成材料；排期变更和发布需要负责人及团队共同确认。'),
      {
        id: 'stakeholder-clue',
        text: '许知收到合成组织者反馈：名单导出可在下周活动前交付，今天最关心报名可靠性。',
        origin: 'fictional-case',
        knownBy: ['xu'],
      },
    ],
    artifactFields: [
      { id: 'goal', label: '用户问题与目标', hint: '说明用户是谁、遇到了什么问题。' },
      { id: 'scope', label: '本次范围与暂缓项', hint: '列清保留、调整和暂缓的内容。' },
      { id: 'priority', label: '取舍依据与协作确认', hint: '引用价值、风险和资源材料，写明需要谁确认。' },
      { id: 'acceptance', label: '验收标准与待确认问题', hint: '把成功条件写成团队能够共同核验的描述。' },
    ],
    task: {
      id: 'deliverable',
      title: '提交范围取舍与验收说明',
      brief: '听取团队意见，整理优先级和验收建议，请许知复核。',
    },
  },
}
export const galgameDefinitions: GalgameDefinition[] = Object.values(fixtures).map((value) =>
  GalgameDefinitionSchema.parse(value),
)
export const identityDescriptions = {
  intern: { label: '实习生', description: '先在导师带领下收集材料和提出建议，关键结论由导师复核。' },
  graduate: { label: '应届新人', description: '尝试独立整理工作产物，遇到权限和未知事项主动确认。' },
  'career-changer': {
    label: '转行新人',
    description: '带着过去的经验进入新岗位，明确已有经验与仍需验证的能力。',
  },
}
