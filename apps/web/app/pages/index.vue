<script setup lang="ts">
import type { Session } from '~/types/game'
const { ensure, mutate } = useIdentity()
const busy = ref(false)
const error = ref('')
const { data: catalog } = await useFetch<{
  occupations: { id: string; packId: string; status: string }[]
  provider: string
}>('/api/catalog')
const playable = computed(() => catalog.value?.occupations.some((o) => o.status === 'playable') ?? false)
async function start() {
  busy.value = true
  error.value = ''
  try {
    await ensure()
    const session = await mutate<Session>('/api/sessions', {
      packId: catalog.value?.occupations[0]?.packId || 'qa-last-hour',
      seed: crypto.randomUUID(),
    })
    await navigateTo(`/play/${session.id}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '暂时无法开启，请稍后重试'
  } finally {
    busy.value = false
  }
}
useSeoMeta({ title: '职境漫游 · 先走进一天，再想象未来' })
</script>
<template>
  <main id="main" class="home-main">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow"><span class="little-star">✳</span> 给未来的你，一次小小的试走</p>
        <h1>
          先走进<span class="serif-emphasis">一天，</span><br />再想象<span class="serif-emphasis"
            >未来。</span
          >
        </h1>
        <p class="hero-description">
          职业不只是一个名字。<br />在故事里，认识一群同事，接住一件小事，<br
            class="desktop-only"
          />发现你在意的工作与生活。
        </p>
        <div class="hero-actions">
          <button class="primary-button" :disabled="busy || !playable" @click="start">
            {{ busy ? '正在准备你的工位…' : playable ? '开启第一段职境' : '职境暂未开放' }}
            <span aria-hidden="true">↗</span></button
          ><a href="#occupations" class="text-link">看看可以去哪 <span aria-hidden="true">↓</span></a>
        </div>
        <p class="hero-footnote"><span class="status-dot" /> 无需经验 · 随时可以下班 · 没有标准答案</p>
      </div>
      <div class="hero-art">
        <ArtImage
          asset-id="bg_office_day_wide"
          alt="午后的栖木工作室，明亮工位与绿植"
          eager
          class="hero-background"
        />
        <div class="hero-wash" />
        <div class="hero-character">
          <ArtImage asset-id="chr_lin_work_half_neutral" alt="林澄，与你协作的资深测试工程师" eager />
        </div>
        <div class="scene-caption">
          <span class="status-dot" /> 栖木工作室 <span class="caption-time">17:00</span>
        </div>
        <div class="hero-note">
          <span class="note-dot" />
          <p>“来得刚好。<br />有件小事，想听听你的看法。”</p>
          <span class="note-sign">林澄 · 你的新同事</span>
        </div>
        <div class="hero-stamp">YOUR NEXT<br /><strong>POSSIBLE DAY</strong><span>01 / 职境初见</span></div>
      </div>
    </section>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <section class="intro-strip" aria-label="体验方式">
      <span class="strip-label">这里的探索<br /><strong>从一个“如果”开始</strong></span>
      <div>
        <span class="step-number">01</span>
        <p>走进真实感的日常<small>具体的任务，鲜活的同事</small></p>
      </div>
      <div>
        <span class="step-number">02</span>
        <p>按自己的方式选择<small>可以提问、尝试，也可以拒绝</small></p>
      </div>
      <div>
        <span class="step-number">03</span>
        <p>带着新问题回来<small>留一点感受，或暂时不总结</small></p>
      </div>
    </section>
    <section id="occupations" class="occupations">
      <div class="section-heading">
        <div>
          <p class="eyebrow">CHOOSE A DAY TO STEP INTO</p>
          <h2>今天，想走近哪一种工作？</h2>
        </div>
        <span class="outlined-label">{{ playable ? '01' : '00' }} 个开放职境</span>
      </div>
      <div class="occupation-grid">
        <article class="occupation-card playable">
          <div class="card-visual">
            <ArtImage asset-id="bg_testing_day_wide" alt="用于测试预约流程的设备与工作台" /><span
              class="card-badge"
              >{{ playable ? '可体验' : '准备中' }} · 原创合成</span
            ><span class="card-number">01</span>
          </div>
          <div class="card-content">
            <p class="occupation-meta">科技与产品 <span>约 10–20 分钟</span></p>
            <h3>软件测试工程师</h3>
            <p class="card-story">上线前的最后一小时</p>
            <p class="card-description">
              一次重复的预约，三种不同的判断。你的第一份任务，是和团队一起弄清楚问题。
            </p>
            <div class="card-bottom">
              <div class="mini-cast">
                <ArtImage asset-id="avatar_lin_neutral" alt="林澄">澄</ArtImage
                ><ArtImage asset-id="avatar_zhou_neutral" alt="周砚">砚</ArtImage
                ><ArtImage asset-id="avatar_xu_neutral" alt="许知">知</ArtImage><span>3 位新同事</span>
              </div>
              <button
                class="circle-button"
                :disabled="busy || !playable"
                aria-label="进入软件测试职境"
                @click="start"
              >
                ↗
              </button>
            </div>
          </div>
        </article>
        <article class="coming-card">
          <span class="coming-icon" aria-hidden="true">⌁</span>
          <p class="eyebrow">还有许多种可能</p>
          <h3>下一段职境，<br />正在慢慢生长。</h3>
          <p>更多不同的工作内容，<br />等待下一次相遇。</p>
          <span class="outlined-label">筹备中 · 暂不可游玩</span>
          <div class="coming-lines" aria-hidden="true" />
        </article>
        <aside class="exploration-note">
          <span class="note-corner" aria-hidden="true">✳</span>
          <p class="eyebrow">一点出发前的话</p>
          <h3>你不需要<br />立刻找到答案。</h3>
          <p>喜欢、不喜欢，或是还说不清，都可以。在这里做出的选择，不会被换算成适配分数。</p>
          <div class="note-divider" />
          <p class="handwritten">先靠近一点，<br />再听听自己的感受。</p>
          <small
            >{{ catalog?.provider === 'openai' ? '已配置在线角色对话' : '当前为模拟对话体验'
            }}<br />人物与组织均为虚构，行业核验待完成。</small
          >
        </aside>
      </div>
    </section>
  </main>
</template>
