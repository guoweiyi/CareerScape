import type { Choice, StoryNode, WorldState, GameInstance, CharacterId } from '../../../../packages/contracts'
export interface User {
  id: string
  username: string | null
  isGuest: boolean
  roles: string[]
}
export interface Identity {
  user: User | null
  csrfToken: string | null
}
export interface Message {
  id: string
  eventSeq: number
  speakerId: CharacterId | 'player' | 'narrator'
  text: string
  channel: string
  recipientId?: string
  expression?: string
}
export interface Branch {
  id: string
  parentBranchId: string | null
  forkEventSeq: number
  label?: string
}
export interface Session {
  provider: string
  id: string
  title: string
  branchId: string
  revision: number
  status: string
  packId: string
  packVersion: number
  assetManifestVersion: string
  state: WorldState
  node: StoryNode
  choices: Choice[]
  messages: Message[]
  branches: Branch[]
  instance: GameInstance
  createdAt: string
  updatedAt: string
  hasMoreHistory?: boolean
  prefetchAssetIds?: string[]
  lastIntent?: {
    kind: 'leave' | 'help' | 'choice' | 'clarify' | 'chat'
    choiceId?: string
    confidence: number
    confirmationLabel: string
  } | null
}
export interface SessionSummary {
  id: string
  title: string
  status: string
  updatedAt: string
  revision: number
}
export interface ArtAsset {
  id: string
  url: string
  width: number
  height: number
  bytes?: number
  variants?: { mobile?: { url: string; bytes?: number }; retina?: { url: string; bytes?: number } }
}
export const people = {
  lin: { name: '林澄', role: '资深测试工程师', initial: '澄', color: '#48715b' },
  zhou: { name: '周砚', role: '开发工程师', initial: '砚', color: '#536b83' },
  xu: { name: '许知', role: '产品经理', initial: '知', color: '#a6654a' },
  narrator: { name: '此刻', role: '场景旁白', initial: '境', color: '#7e867a' },
  player: { name: '我', role: '探索者', initial: '我', color: '#285b4b' },
} as const
