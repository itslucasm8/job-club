import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

export function getAnthropic(): Anthropic | null {
  if (_client) return _client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  _client = new Anthropic({ apiKey })
  return _client
}

export const CLASSIFIER_MODEL = 'claude-opus-4-7'
export const EXTRACTOR_MODEL = 'claude-opus-4-7'
