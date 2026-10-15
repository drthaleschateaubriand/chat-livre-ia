export interface Conversation {
  id: string
  title: string
  pinned: boolean
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  seq?: number
  conversation_id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  provider?: string | null
  model?: string | null
  fallback_used?: boolean
  created_at: string
  /** apenas no cliente */
  pending?: boolean
}

export interface Preferences {
  theme: 'system' | 'light' | 'dark'
  font_size: 'sm' | 'md' | 'lg'
  language: string
  memory_enabled: boolean
  default_model: string
  auto_speak: boolean
  allow_paid_auto: boolean
}

export interface Memory {
  id: string
  content: string
  created_at: string
  updated_at: string
}

export interface DeviceSession {
  id: string
  device_name: string
  created_at: string
  last_seen_at: string
  persistent: boolean
  current: boolean
}

export interface CatalogModel {
  provider: string
  id: string
  label: string
  rank: number
  cooldownUntil: number | null
  available: boolean
  unverified?: boolean
}

export interface CatalogProvider {
  provider: string
  name: string
  keyUrl: string | null
  anonymous: boolean
  note: string
  paid?: boolean
  configured: boolean
  models: CatalogModel[]
}

export interface UsageRow {
  provider: string
  model: string
  requests: number
  tokens_in: number
  tokens_out: number
  errors: number
  rate_limited: number
  limit_info: Record<string, string> | null
}

export interface SessionTokens {
  access: string
  refresh: string
  accessExp: number
  persistent: boolean
}
