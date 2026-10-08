<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { z } from 'zod'
import type { ContentPack, StoryNode } from '../../../../packages/contracts'
import { projectStoryGraph, updateStoryNode, type StudioNodePatch } from '../../../../packages/content/studio'

const props = withDefaults(defineProps<{ modelValue: ContentPack; readonly?: boolean }>(), {
  readonly: false,
})
const emit = defineEmits<{ 'update:modelValue': [pack: ContentPack]; 'dirty-change': [dirty: boolean] }>()
const formSchema = z.object({
  title: z.string().trim().min(1, '节点标题不能为空。').max(100, '标题最多100字。'),
  backgroundId: z.enum(['office', 'meeting', 'testing', 'terrace']),
  explanation: z.string().max(3000, '可选解释最多3000字。'),
  messages: z
    .array(
      z.object({
        speakerId: z.enum(['narrator', 'lin', 'zhou', 'xu']),
        expression: z.enum(['neutral', 'relaxed', 'thinking', 'serious']),
        text: z.string().trim().min(1, '对白不能为空。').max(3000, '每段对白最多3000字。'),
      }),
    )
    .min(1)
    .max(8),
  choices: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().trim().min(1, '选项名称不能为空。').max(140, '选项名称最多140字。'),
        description: z.string().max(300, '选项说明最多300字。'),
        targetNodeId: z.string().min(1, '请选择目标节点。'),
      }),
    )
    .max(8),
})
type NodeDraft = z.infer<typeof formSchema>
const identifier = useId().replace(/[^a-z0-9_-]/gi, '')
const graphTitleId = `${identifier}-graph-title`
const formTitleId = `${identifier}-form-title`
const arrowId = `${identifier}-arrow`
const editable = computed(() => !props.readonly && props.modelValue.contentStatus === 'draft')
const selectedId = ref(props.modelValue.startNodeId || props.modelValue.nodes[0]?.nodeId || '')
const selectedNode = computed(() => props.modelValue.nodes.find((node) => node.nodeId === selectedId.value))
const projection = computed(() => projectStoryGraph(props.modelValue))
const pendingNodeId = ref('')
const pendingNodeTitle = computed(
  () =>
    props.modelValue.nodes.find((node) => node.nodeId === pendingNodeId.value)?.title || pendingNodeId.value,
)
const error = ref('')
const notice = ref('')
const externalConflict = ref(false)
const sourceFingerprint = ref('')
const baseline = ref('')
function nodeDraft(node: StoryNode): NodeDraft {
  return {
    title: node.title,
    backgroundId: node.backgroundId,
    explanation: node.metadata.explanation,
    messages: node.messages.map((message) => ({ ...message })),
    choices: node.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      description: choice.description,
      targetNodeId: choice.targetNodeId,
    })),
  }
}
const draft = ref<NodeDraft | null>(null)
const dirty = computed(() => draft.value !== null && JSON.stringify(draft.value) !== baseline.value)
watch(dirty, (value) => emit('dirty-change', value), { immediate: true, flush: 'sync' })

function loadNode(nodeId: string, clearNotice = true) {
  const node = props.modelValue.nodes.find((item) => item.nodeId === nodeId)
  if (!node) return
  selectedId.value = nodeId
  const next = nodeDraft(node)
  baseline.value = JSON.stringify(next)
  draft.value = next
  sourceFingerprint.value = JSON.stringify(node)
  pendingNodeId.value = ''
  externalConflict.value = false
  error.value = ''
  if (clearNotice) notice.value = ''
}
function selectNode(nodeId: string) {
  if (nodeId === selectedId.value) return
  if (dirty.value) {
    pendingNodeId.value = nodeId
    return
  }
  loadNode(nodeId)
}
function discardAndSwitch() {
  if (pendingNodeId.value) loadNode(pendingNodeId.value)
}
function resetNode() {
  loadNode(selectedId.value)
}
watch(
  () => props.modelValue,
  () => {
    const current = selectedNode.value
    if (dirty.value) {
      if (!current || JSON.stringify(current) !== sourceFingerprint.value) externalConflict.value = true
      return
    }
    loadNode(
      current?.nodeId || props.modelValue.startNodeId || props.modelValue.nodes[0]?.nodeId || '',
      false,
    )
  },
  { immediate: true },
)

function applyNode() {
  if (!editable.value || !draft.value || externalConflict.value) return
  error.value = ''
  const parsed = formSchema.safeParse(draft.value)
  if (!parsed.success) {
    error.value = parsed.error.issues.map((issue) => issue.message).join('；')
    return
  }
  try {
    const patch: StudioNodePatch = parsed.data
    const updated = updateStoryNode(props.modelValue, selectedId.value, patch)
    const node = updated.nodes.find((item) => item.nodeId === selectedId.value)
    if (!node) throw new Error('节点更新后无法找到，请重新载入草稿。')
    const nextDraft = nodeDraft(node)
    baseline.value = JSON.stringify(nextDraft)
    draft.value = nextDraft
    sourceFingerprint.value = JSON.stringify(node)
    pendingNodeId.value = ''
    notice.value = '已应用到本地草稿。请在工作台保存，再执行检查、审核和发布。'
    emit('update:modelValue', updated)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '节点修改未应用，请检查内容后重试。'
  }
}

const backgrounds = [
  { label: '开放办公室', value: 'office' },
  { label: '会议角', value: 'meeting' },
  { label: '软件测试区', value: 'testing' },
  { label: '休息露台', value: 'terrace' },
]
const expressions = [
  { label: '平静', value: 'neutral' },
  { label: '轻松', value: 'relaxed' },
  { label: '思考', value: 'thinking' },
  { label: '严肃', value: 'serious' },
]
const speakers = computed(() => [
  { label: '旁白', value: 'narrator' },
  ...props.modelValue.characters.map((character) => ({
    label: `${character.name} · ${character.role}`,
    value: character.id,
  })),
])
const targets = computed(() =>
  props.modelValue.nodes.map((node) => ({ label: `${node.title} · ${node.nodeId}`, value: node.nodeId })),
)
const nodeTypeLabels: Record<StoryNode['nodeType'], string> = {
  scene: '场景',
  dialogue: '对话',
  choice: '选择',
  savepoint: '存档点',
  ending: '结局',
}
const statusLabels: Record<ContentPack['contentStatus'], string> = {
  draft: '草稿',
  auto_checked: '已检查',
  approved: '已审核',
  published: '已发布',
  withdrawn: '已撤回',
}
const card = { width: 244, height: 116, padding: 20 }
const graphWidth = computed(() =>
  Math.max(660, ...projection.value.nodes.map((node) => node.x + card.width + card.padding * 2)),
)
const graphHeight = computed(() =>
  Math.max(260, ...projection.value.nodes.map((node) => node.y + card.height + card.padding * 2)),
)
function nodeStyle(node: { x: number; y: number }) {
  return {
    left: `${((node.x + card.padding) / graphWidth.value) * 100}%`,
    top: `${node.y + card.padding}px`,
    width: `${(card.width / graphWidth.value) * 100}%`,
    height: `${card.height}px`,
  }
}
const graphEdges = computed(() =>
  projection.value.edges.flatMap((edge) => {
    const from = projection.value.nodes.find((node) => node.id === edge.from)
    const to = projection.value.nodes.find((node) => node.id === edge.to)
    if (!from || !to) return []
    const x1 = from.x + card.width + card.padding,
      y1 = from.y + card.padding + card.height / 2
    const x2 = to.x + card.padding - 5,
      y2 = to.y + card.padding + card.height / 2
    const bend = Math.max(28, Math.abs(x2 - x1) * 0.5)
    return [
      {
        ...edge,
        path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
        active: edge.from === selectedId.value || edge.to === selectedId.value,
      },
    ]
  }),
)
function targetTitle(nodeId: string) {
  return props.modelValue.nodes.find((node) => node.nodeId === nodeId)?.title || `不存在的节点：${nodeId}`
}
</script>

<template>
  <section class="content-graph-editor" data-testid="content-graph-editor">
    <header class="studio-heading">
      <div>
        <p class="studio-eyebrow">STORY WORKBENCH</p>
        <h2 :id="graphTitleId">故事怎么走到下一步</h2>
      </div>
      <p class="graph-count">{{ projection.nodes.length }} 个节点 · {{ projection.edges.length }} 条路径</p>
    </header>
    <p class="studio-intro">
      选择一个节点，查看它的对白与去向。节点图只修改本地草稿；保存、检查、审核和发布仍在工作台完成。
    </p>
    <p v-if="!editable" class="studio-readonly" data-testid="graph-readonly">
      当前{{ statusLabels[modelValue.contentStatus] }}版本仅供查看。请先在工作台复制为草稿，再编辑节点。
    </p>

    <div
      class="graph-scroll"
      role="region"
      :aria-labelledby="graphTitleId"
      tabindex="0"
      data-testid="story-graph-scroll"
    >
      <div class="graph-canvas" :style="{ height: `${graphHeight}px` }">
        <svg
          class="graph-lines"
          :viewBox="`0 0 ${graphWidth} ${graphHeight}`"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <marker
              :id="arrowId"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#729080" />
            </marker>
          </defs>
          <path
            v-for="edge in graphEdges"
            :key="edge.id"
            :d="edge.path"
            fill="none"
            :class="{ 'active-edge': edge.active }"
            :marker-end="`url(#${arrowId})`"
          />
        </svg>
        <button
          v-for="node in projection.nodes"
          :key="node.id"
          type="button"
          class="graph-node"
          :class="{
            'is-selected': selectedId === node.id,
            'is-ending': node.ending,
            'is-unreachable': !node.reachable,
          }"
          :style="nodeStyle(node)"
          :aria-pressed="selectedId === node.id"
          :aria-label="`${node.title}，${nodeTypeLabels[node.nodeType]}${node.id === modelValue.startNodeId ? '，起点' : ''}${!node.reachable ? '，从起点不可达' : ''}`"
          :title="node.title"
          :data-testid="`story-node-${node.id}`"
          @click="selectNode(node.id)"
        >
          <span class="node-kind"
            >{{ node.id === modelValue.startNodeId ? '起点 · ' : ''
            }}{{ nodeTypeLabels[node.nodeType] }}</span
          >
          <strong>{{ node.title }}</strong>
          <span class="node-code">{{ !node.reachable ? '未连接 · ' : '' }}{{ node.id }}</span>
        </button>
      </div>
    </div>
    <p class="graph-hint">箭头表示选项的去向。窄屏可在图内左右滚动，也可以打开列表视图。</p>
    <details class="graph-linear">
      <summary>列表视图：逐个查看节点与路径</summary>
      <ol>
        <li v-for="node in modelValue.nodes" :key="node.nodeId">
          <button
            type="button"
            :aria-pressed="selectedId === node.nodeId"
            :data-testid="`story-node-list-${node.nodeId}`"
            @click="selectNode(node.nodeId)"
          >
            {{ node.title }} <span>({{ nodeTypeLabels[node.nodeType] }})</span>
          </button>
          <ul v-if="node.choices.length">
            <li v-for="choice in node.choices" :key="choice.id">
              {{ choice.label }} → {{ targetTitle(choice.targetNodeId) }}
            </li>
          </ul>
          <p v-else>此节点没有后续选项。</p>
        </li>
      </ol>
    </details>

    <section
      class="studio-diagnostics"
      :class="{ 'has-problems': projection.diagnostics.length }"
      aria-label="剧情图诊断"
      data-testid="graph-diagnostics"
    >
      <h3>
        {{
          projection.diagnostics.length
            ? `有 ${projection.diagnostics.length} 项需要检查`
            : '未发现剧情图结构问题'
        }}
      </h3>
      <ul v-if="projection.diagnostics.length">
        <li v-for="(diagnostic, index) in projection.diagnostics" :key="`${diagnostic.code}-${index}`">
          <button
            v-if="diagnostic.nodeId && modelValue.nodes.some((node) => node.nodeId === diagnostic.nodeId)"
            type="button"
            @click="selectNode(diagnostic.nodeId!)"
          >
            定位节点</button
          ><span>{{ diagnostic.message }}</span>
        </li>
      </ul>
      <p v-else>这项本地诊断不代替工作台的保存后检查、内容审核或发布校验。</p>
    </section>

    <div v-if="pendingNodeId" class="studio-warning" role="alert" data-testid="node-switch-warning">
      <p>当前节点有未应用修改。切换到“{{ pendingNodeTitle }}”前，请决定是否保留。</p>
      <div class="studio-actions">
        <button
          type="button"
          class="studio-secondary"
          data-testid="discard-node-and-switch"
          @click="discardAndSwitch"
        >
          丢弃修改并切换</button
        ><button type="button" class="studio-primary" @click="pendingNodeId = ''">继续编辑当前节点</button>
      </div>
    </div>
    <div v-if="externalConflict" class="studio-warning" role="alert">
      <p>当前节点已在其他编辑位置更新。为避免覆盖修改，请重新载入节点后再编辑。</p>
      <button type="button" class="studio-secondary" @click="resetNode">丢弃未应用修改，载入最新节点</button>
    </div>

    <section v-if="selectedNode && draft" class="node-editor" :aria-labelledby="formTitleId">
      <header class="node-editor-heading">
        <div>
          <p class="studio-eyebrow">
            {{ selectedNode.nodeId }} · {{ nodeTypeLabels[selectedNode.nodeType] }}
          </p>
          <h3 :id="formTitleId">{{ selectedNode.title }}</h3>
        </div>
        <span v-if="dirty" class="dirty-label" role="status" data-testid="node-dirty">有未应用修改</span>
      </header>
      <UForm :schema="formSchema" :state="draft" class="node-form" @submit="applyNode">
        <fieldset :disabled="!editable">
          <legend class="studio-sr-only">节点内容</legend>
          <div class="editor-row">
            <UFormField label="节点标题" name="title"
              ><UInput
                v-model="draft.title"
                :maxlength="100"
                class="w-full"
                size="lg"
                data-testid="node-title"
            /></UFormField>
            <UFormField label="场景背景" name="backgroundId"
              ><USelect
                v-model="draft.backgroundId"
                :items="backgrounds"
                class="w-full"
                size="lg"
                data-testid="node-background"
            /></UFormField>
          </div>
          <section class="editor-block" aria-label="节点对白">
            <h4>
              节点对白 <span>{{ draft.messages.length }} 段</span>
            </h4>
            <p class="field-help">编辑已有对白的人物、表情与正文；顺序和数量保持不变。</p>
            <fieldset
              v-for="(message, index) in draft.messages"
              :key="`${selectedId}-message-${index}`"
              class="message-fields"
            >
              <legend>第 {{ index + 1 }} 段对白</legend>
              <div class="editor-row">
                <UFormField label="说话人" :name="`messages.${index}.speakerId`"
                  ><USelect
                    v-model="message.speakerId"
                    :items="speakers"
                    class="w-full"
                    :data-testid="`node-message-${index}-speaker`" /></UFormField
                ><UFormField label="表情" :name="`messages.${index}.expression`"
                  ><USelect
                    v-model="message.expression"
                    :items="expressions"
                    class="w-full"
                    :data-testid="`node-message-${index}-expression`"
                /></UFormField>
              </div>
              <UFormField label="对白正文" :name="`messages.${index}.text`"
                ><UTextarea
                  v-model="message.text"
                  :rows="3"
                  :maxlength="3000"
                  class="w-full"
                  :data-testid="`node-message-${index}-text`"
              /></UFormField>
            </fieldset>
          </section>
          <UFormField label="可选解释" name="explanation" description="由玩家主动展开，不替代人物对白。"
            ><UTextarea
              v-model="draft.explanation"
              :rows="3"
              :maxlength="3000"
              class="w-full"
              data-testid="node-explanation"
          /></UFormField>
          <section class="editor-block" aria-label="节点选项">
            <h4>
              已有选项 <span>{{ draft.choices.length }} 项</span>
            </h4>
            <p v-if="!draft.choices.length" class="field-help">
              这是没有后续选项的节点，图形编辑器不会为它新增路径。
            </p>
            <p v-else class="field-help">
              名称、说明和目标可以修改。触发条件、状态效果与选项回应保留原有内容。
            </p>
            <fieldset
              v-for="(choice, index) in draft.choices"
              :key="`${selectedId}-${choice.id}`"
              class="message-fields"
            >
              <legend>选项 {{ index + 1 }} · {{ choice.id }}</legend>
              <UFormField label="选项名称" :name="`choices.${index}.label`"
                ><UInput
                  v-model="choice.label"
                  :maxlength="140"
                  class="w-full"
                  :data-testid="`node-choice-${choice.id}-label`"
              /></UFormField>
              <UFormField label="选项说明" :name="`choices.${index}.description`"
                ><UTextarea
                  v-model="choice.description"
                  :rows="2"
                  :maxlength="300"
                  class="w-full"
                  :data-testid="`node-choice-${choice.id}-description`"
              /></UFormField>
              <UFormField label="目标节点" :name="`choices.${index}.targetNodeId`"
                ><USelect
                  v-model="choice.targetNodeId"
                  :items="targets"
                  class="w-full"
                  :data-testid="`node-choice-${choice.id}-target`"
              /></UFormField>
            </fieldset>
          </section>
        </fieldset>
        <p v-if="error" class="studio-warning" role="alert" data-testid="node-apply-error">{{ error }}</p>
        <p v-if="notice" class="studio-notice" role="status" data-testid="node-apply-success">{{ notice }}</p>
        <div class="studio-actions">
          <UButton
            type="submit"
            size="lg"
            :disabled="!editable || !dirty || externalConflict"
            data-testid="apply-node"
            >{{ editable ? '应用本节点修改' : '复制为草稿后可编辑' }}</UButton
          ><button v-if="dirty && editable" type="button" class="studio-secondary" @click="resetNode">
            还原本节点未应用修改
          </button>
        </div>
      </UForm>
    </section>
  </section>
</template>

<style scoped>
.content-graph-editor {
  min-width: 0;
  max-width: 100%;
  color: #20332d;
}
.studio-heading,
.node-editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}
.studio-heading h2,
.node-editor-heading h3 {
  margin: 4px 0 0;
  font-size: 23px;
  line-height: 1.45;
}
.studio-eyebrow {
  margin: 0;
  color: #5c6962;
  font-size: 11px;
  letter-spacing: 0.13em;
  overflow-wrap: anywhere;
}
.graph-count,
.graph-hint,
.field-help,
.studio-intro {
  color: #5c6962;
  line-height: 1.65;
}
.graph-count {
  font-size: 13px;
}
.studio-intro {
  margin: 16px 0;
  font-size: 14px;
}
.studio-readonly {
  padding: 14px 18px;
  background: #f1eee7;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.65;
}
.graph-scroll {
  width: 100%;
  max-width: 100%;
  overflow: auto;
  border: 1px solid #d6ded3;
  border-radius: 18px;
  background: #f6f8f2;
  overscroll-behavior-inline: contain;
}
.graph-canvas {
  position: relative;
  width: 100%;
  min-width: 0;
  background-image: radial-gradient(#d9e0d4 0.8px, transparent 0.8px);
  background-size: 18px 18px;
}
.graph-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.graph-lines > path {
  stroke: #9aaea0;
  stroke-width: 1.8;
  vector-effect: non-scaling-stroke;
}
.graph-lines > path.active-edge {
  stroke: #285b4b;
  stroke-width: 2.7;
}
.graph-node {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 5px;
  padding: 11px 12px;
  border: 1px solid #cbd7c9;
  border-radius: 12px;
  background: #fffefa;
  color: #20332d;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 2px 4px #20332d05;
}
.graph-node strong {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  width: 100%;
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.graph-node.is-selected {
  border: 2px solid #285b4b;
  background: #e9f0e5;
  box-shadow: 0 0 0 3px #285b4b12;
}
.graph-node.is-ending:not(.is-selected) {
  background: #f4eee5;
  border-color: #d8c6af;
}
.graph-node.is-unreachable {
  border-style: dashed;
}
.node-kind {
  color: #285b4b;
  font-size: 11px;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.node-code {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  color: #5c6962;
  font-size: 10px;
}
.graph-hint {
  margin: 10px 0 16px;
  font-size: 12px;
}
.graph-linear {
  margin: 12px 0 18px;
  padding: 12px 16px;
  border: 1px solid #d6ded3;
  border-radius: 12px;
}
.graph-linear summary {
  cursor: pointer;
  min-height: 28px;
  line-height: 28px;
  font-size: 14px;
}
.graph-linear ol {
  padding-left: 22px;
}
.graph-linear li {
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.graph-linear button,
.studio-diagnostics button {
  border: 0;
  background: transparent;
  color: #285b4b;
  text-align: left;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  padding: 8px 4px;
  min-height: 44px;
}
.graph-linear button[aria-pressed='true'] {
  font-weight: 700;
}
.graph-linear ul,
.graph-linear p {
  color: #5c6962;
  font-size: 13px;
  line-height: 1.7;
}
.studio-diagnostics {
  padding: 16px 18px;
  background: #edf3e9;
  border-radius: 12px;
  margin: 18px 0;
}
.studio-diagnostics h3 {
  margin: 0 0 6px;
  font-size: 15px;
}
.studio-diagnostics p {
  margin: 0;
  color: #5c6962;
  font-size: 13px;
  line-height: 1.6;
}
.studio-diagnostics.has-problems {
  background: #fbf1e9;
  border: 1px solid #dcbfa7;
}
.studio-diagnostics ul {
  margin: 8px 0 0;
  padding-left: 20px;
}
.studio-diagnostics li {
  line-height: 1.7;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.studio-diagnostics li button {
  margin-right: 8px;
}
.studio-warning {
  padding: 16px;
  color: #713e26;
  background: #fff1e6;
  border: 1px solid #dcb79b;
  border-radius: 12px;
  line-height: 1.65;
  margin: 14px 0;
}
.studio-warning p {
  margin: 0 0 12px;
}
.studio-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.studio-secondary,
.studio-primary {
  min-height: 44px;
  border-radius: 12px;
  padding: 10px 16px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.studio-secondary {
  background: #fffefa;
  color: #285b4b;
  border: 1px solid #aabdac;
}
.studio-primary {
  background: #285b4b;
  color: #fff;
  border: 1px solid #285b4b;
}
.node-editor {
  margin-top: 24px;
  padding: 24px;
  border: 1px solid #d6ded3;
  border-radius: 18px;
  background: #fffefa;
}
.node-editor-heading {
  padding-bottom: 20px;
  border-bottom: 1px solid #e2e7dc;
  margin-bottom: 24px;
}
.node-editor-heading h3 {
  font-size: 20px;
  overflow-wrap: anywhere;
}
.dirty-label {
  padding: 5px 10px;
  border-radius: 999px;
  background: #fbefe1;
  color: #794922;
  font-size: 12px;
}
.node-form,
.node-form > fieldset {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.node-form fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.editor-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}
.editor-row > * {
  min-width: 0;
}
.editor-block h4 {
  margin: 0;
  font-size: 16px;
}
.editor-block h4 span {
  margin-left: 10px;
  font-size: 12px;
  font-weight: 400;
  color: #5c6962;
}
.field-help {
  font-size: 13px;
  margin: 6px 0 16px;
}
.node-form .message-fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  margin-top: 14px;
  border: 1px solid #e0e6d9;
  border-radius: 12px;
}
.message-fields legend {
  padding: 0 6px;
  font-size: 12px;
  color: #5c6962;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.studio-notice {
  padding: 14px 16px;
  border-radius: 12px;
  background: #e9f0e5;
  color: #285b4b;
  line-height: 1.65;
  margin: 0;
}
.studio-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.content-graph-editor :is(button, summary, .graph-scroll):focus-visible {
  outline: 3px solid #a64732;
  outline-offset: 4px;
}
@media (max-width: 700px) {
  .graph-canvas {
    min-width: 960px;
  }
  .studio-heading h2 {
    font-size: 20px;
  }
  .node-editor {
    padding: 16px;
  }
  .editor-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  .node-form .message-fields {
    padding: 14px;
  }
  .studio-actions > :is(button, a) {
    max-width: 100%;
    white-space: normal;
  }
}
</style>
