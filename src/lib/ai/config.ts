/**
 * AI provider configuration — SERVER-ONLY. Never prefix these with
 * NEXT_PUBLIC and never import this module from a client component.
 *
 * The provider is OpenRouter (OpenAI-compatible `/chat/completions`), so the
 * model can be swapped with `AI_MODEL` and the endpoint with `AI_BASE_URL`
 * without touching any business tool.
 */

export const aiConfig = {
  /** OpenRouter API key (server-side only). */
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
  /** OpenAI-compatible base URL (OpenRouter by default). */
  baseUrl: (process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
  /** Model id as OpenRouter expects it, e.g. "openai/gpt-4o-mini". */
  model: process.env.AI_MODEL ?? 'openai/gpt-4o-mini',
};

/** True when the provider is usable (key present). */
export const isAiConfigured = Boolean(aiConfig.apiKey);
