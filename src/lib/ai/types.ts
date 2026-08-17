/**
 * SenjaMart AI Agent — shared types.
 *
 * This module (and everything under `src/lib/ai/`) is SERVER-ONLY:
 * it must never be imported from a client component. It reads
 * OPENROUTER_API_KEY and talks to Supabase with the signed-in user's own
 * server-side session (RLS is the enforcement layer — no service role).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type AiMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AiMessage {
  role: AiMessageRole;
  content: string;
  /** Tool-call id this result answers (role === 'tool'). */
  tool_call_id?: string;
  /** Tool name (role === 'tool'). */
  name?: string;
  /** Tool calls made by an assistant message (so providers can reconstruct the chain). */
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed JSON arguments. */
  arguments: Record<string, unknown>;
}

export type ToolType = 'read' | 'analysis' | 'action';

export interface ToolSpec {
  name: string;
  description: string;
  type: ToolType;
  /** OpenAI-compatible function schema (for model tool-calling). */
  parameters: Record<string, unknown>;
}

export interface ToolActivity {
  tool: string;
  type: ToolType;
  status: 'ok' | 'error';
  /** Short human label shown in the UI (e.g. "membaca pesanan"). */
  summary: string;
  ts: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Runtime context passed to every tool handler (user-bound server client). */
export interface AgentContext {
  supabase: SupabaseClient;
  userId: string;
}

export interface ConfirmationRequest {
  /** Single-use, session-bound token — only this token authorizes the write. */
  token: string;
  action: string;
  /** Human-readable target, e.g. "Pesanan SJ-20260813-XXXX". */
  target: string;
  /** Human-readable summary shown in the confirmation dialog. */
  summary: string;
}

export interface AgentResult {
  /** Natural-language reply to the user. */
  reply: string;
  toolActivity: ToolActivity[];
  /** Non-null when the model requested a write that needs confirmation. */
  confirmation: ConfirmationRequest | null;
}

/** Decides which tools to call for a message batch. Injected for tests. */
export interface Planner {
  (input: {
    messages: AiMessage[];
    tools: ToolSpec[];
  }): Promise<{ content: string; toolCalls: ToolCall[] }>;
}

export interface AgentOptions {
  messages: AiMessage[];
  /** Override the default LLM planner (tests). */
  planner?: Planner;
  /** Confirmation payload from a previous response. */
  confirmation?: { token: string };
}

export interface PendingAction {
  token: string;
  userId: string;
  action: string;
  target: string;
  params: Record<string, unknown>;
  /** Assistant message that requested the action (kept so the provider chain stays valid). */
  assistantMessage: AiMessage;
  /** The exact tool call being confirmed. */
  toolCall: ToolCall;
  createdAt: number;
}
