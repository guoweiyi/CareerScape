import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { invariant } from '../database'

export type ModelProvider = 'google' | 'openai'
export function roleProviderName(): ModelProvider | 'mock' {
  return process.env.AI_PROVIDER === 'google' ? 'google' : process.env.AI_PROVIDER === 'openai' ? 'openai' : 'mock'
}

/** Server-only settings. Never expose this object (it contains the API key). */
export function modelConfig(provider: ModelProvider) {
  const google = provider === 'google'
  const apiKey = (google ? process.env.GOOGLE_GENERATIVE_AI_API_KEY : process.env.OPENAI_API_KEY)?.trim() || ''
  const model = (google ? process.env.GOOGLE_MODEL : process.env.OPENAI_MODEL)?.trim() || ''
  let url = (google ? process.env.GOOGLE_BASE_URL : process.env.OPENAI_BASE_URL)?.trim() ||
    (google ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.openai.com/v1')
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash)
      return { provider, available: false, url: '', model, apiKey }
    url = url.replace(/\/+$/, '')
    if (google && parsed.pathname.replace(/\/+$/, '') === '') url += '/v1beta'
  } catch {
    return { provider, available: false, url: '', model, apiKey }
  }
  return { provider, available: Boolean(apiKey && model), url, model, apiKey }
}

export function configuredModel(provider: ModelProvider) {
  const config = modelConfig(provider)
  invariant(config.available, 'AI_UNAVAILABLE', 503, 'AI 服务配置不完整，请稍后再试。')
  return provider === 'google'
    ? createGoogle({ apiKey: config.apiKey, baseURL: config.url })(config.model)
    : createOpenAI({ apiKey: config.apiKey, baseURL: config.url }).chat(config.model)
}

export function modelProviderOptions(provider: ModelProvider) {
  // Interactive Gemini Flash turns should spend their budget on the visible response.
  return provider === 'google' && /^gemini-3.*flash/.test(modelConfig(provider).model)
    ? { google: { thinkingConfig: { thinkingLevel: 'minimal' as const } } }
    : undefined
}
