<script setup lang="ts">
import type { CareerId, GalgameSessionDTO, PlayerProfile } from '../../../../../packages/contracts/galgame'
const { ensure, mutate } = useIdentity()
const { data: catalog, error: catalogError } = await useFetch<{
  galgame: {
    available: boolean
    identities: Record<PlayerProfile['identity'], { label: string; description: string }>
    occupations: {
      id: CareerId
      title: string
      storyTitle: string
      description: string
      responsibilities: string[]
      status: string
    }[]
  }
}>('/api/catalog')
const career = ref<CareerId>('qa'),
  player = reactive<PlayerProfile>({ name: '小禾', identity: 'graduate', avatar: 'leaf', background: '' })
const busy = ref(false),
  error = ref('')
const selected = computed(() => catalog.value?.galgame.occupations.find((item) => item.id === career.value))
const avatars = [
  { id: 'leaf' as const, icon: '❋', label: '青叶' },
  { id: 'sun' as const, icon: '☀', label: '晴日' },
  { id: 'star' as const, icon: '✧', label: '微星' },
]
async function start() {
  busy.value = true
  error.value = ''
  try {
    await ensure()
    const session = await mutate<GalgameSessionDTO>('/api/sessions', {
      mode: 'galgame',
      careerId: career.value,
      player: { ...player, name: player.name.trim() },
      seed: crypto.randomUUID(),
    })
    await navigateTo(`/galgame/${session.id}`)
  } catch (cause) {
    const e = cause as { data?: { message?: string }; message?: string }
    error.value = e.data?.message || e.message || '暂时无法开始这段故事。'
  } finally {
    busy.value = false
  }
}
useHead({ title: 'AI 职业故事 · 职境漫游', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>
<template>
  <main id="main" class="page-wrap gal-setup">
    <section class="gal-intro">
      <div>
        <p class="eyebrow">A DAY THAT RESPONDS TO YOU</p>
        <h1 class="page-title">换一种身份，<br />走进会回应你的故事。</h1>
        <p class="muted">和同事相遇，接住一项工作。你提出问题、做出行动，故事就在这里继续生长。</p>
        <div class="gal-tags">
          <span>AI 场景与角色回应</span><span>约 15—25 分钟</span><span>随时保存、下班</span>
        </div>
      </div>
      <div class="gal-intro-art" aria-hidden="true">
        <ArtImage asset-id="bg_office_day_wide" alt="明亮的虚构工作室" eager /><ArtImage
          asset-id="chr_zhou_work_half_relaxed"
          alt="与你协作的前端同事"
          class="gal-intro-person"
          eager
        /><span>今天，会发生什么？</span>
      </div>
    </section>
    <p v-if="catalogError" class="error-message" role="alert">暂时无法读取职业故事，请刷新后重试。</p>
    <form class="gal-setup-grid" @submit.prevent="start">
      <fieldset class="gal-careers">
        <legend><span class="eyebrow">01 / CHOOSE YOUR WORK</span>今天，想走近哪种工作？</legend>
        <button
          v-for="item in catalog?.galgame.occupations"
          :key="item.id"
          type="button"
          class="gal-career-card"
          :class="{ selected: career === item.id }"
          :aria-pressed="career === item.id"
          :disabled="busy"
          @click="career = item.id"
        >
          <span class="gal-career-icon" aria-hidden="true">{{
            item.id === 'qa' ? '⌕' : item.id === 'frontend' ? '⌘' : '◇'
          }}</span>
          <span
            ><strong>{{ item.title }}</strong
            ><small>{{ item.storyTitle }}</small>
            <p>{{ item.description }}</p></span
          >
          <span class="gal-radio-mark" aria-hidden="true">{{ career === item.id ? '●' : '○' }}</span>
        </button>
        <div v-if="selected" class="gal-career-note">
          <h2>你会尝试</h2>
          <ul>
            <li v-for="item in selected.responsibilities" :key="item">{{ item }}</li>
          </ul>
        </div>
      </fieldset>
      <section class="panel gal-profile" aria-labelledby="profile-title">
        <p class="eyebrow">02 / MEET YOUR POSSIBLE SELF</p>
        <h2 id="profile-title">故事里的你</h2>
        <label class="gal-field"
          >名字<input
            v-model="player.name"
            required
            maxlength="24"
            autocomplete="off"
            placeholder="给故事中的自己取一个名字"
            :disabled="busy"
        /></label>
        <fieldset class="gal-identity">
          <legend>以哪种身份入职？</legend>
          <label v-for="(item, id) in catalog?.galgame.identities" :key="id"
            ><input
              v-model="player.identity"
              type="radio"
              name="identity"
              :value="id"
              :disabled="busy"
            /><span
              ><strong>{{ item.label }}</strong
              ><small>{{ item.description }}</small></span
            ></label
          >
        </fieldset>
        <fieldset class="gal-avatar-picker">
          <legend>选一个人物标记</legend>
          <button
            v-for="avatar in avatars"
            :key="avatar.id"
            type="button"
            :class="{ selected: player.avatar === avatar.id }"
            :aria-pressed="player.avatar === avatar.id"
            :aria-label="avatar.label"
            :disabled="busy"
            @click="player.avatar = avatar.id"
          >
            <span aria-hidden="true">{{ avatar.icon }}</span
            >{{ avatar.label }}
          </button>
        </fieldset>
        <label class="gal-field"
          >背景设定 <small>可选</small
          ><textarea
            v-model="player.background"
            maxlength="500"
            rows="3"
            placeholder="例如：我曾组织校园活动，想了解产品工作。"
            :disabled="busy"
          />
        </label>
        <p class="gal-source-note">
          岗位流程有资料依据；团队、同事和本局材料为虚构案例。故事中的工作产物，会成为最后复盘的依据。
        </p>
        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        <p v-if="catalog && !catalog.galgame.available" class="notice">
          AI 职业故事暂未开放。你可以先体验首页的职境故事，之后从这里开始。
        </p>
        <button
          class="primary-button gal-start"
          type="submit"
          :disabled="busy || selected?.status !== 'playable' || !player.name.trim()"
        >
          {{ busy ? '正在为你准备工位…' : '以这个身份，走进故事' }} <span aria-hidden="true">↗</span>
        </button>
      </section>
    </form>
  </main>
</template>
