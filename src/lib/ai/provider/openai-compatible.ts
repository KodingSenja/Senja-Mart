/**
 * OpenAI-compatible chat-completions provider (works with OpenRouter and any
 * compatible endpoint). Uses plain fetch — no SDK, no lock-in.
 *
 * SERVER-ONLY: the API key never leaves this module.
 */

import { aiConfig, isAiConfigured } from '../config';
import type { AiMessage, ToolCall } from '../types';
import type { AIProvider, ProviderChatInput, ProviderChatOutput } from '../provider';

interface OpenAiToolCall {
  id: string;
  type?: string;
  function: { name?: string; arguments?: string };
}

interface OpenAiMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
  name?: string;
}

export class AiProviderNotConfiguredError extends Error {
  constructor() {
    super('AI provider belum dikonfigurasi (OPENROUTER_API_KEY belum diisi).');
    this.name = 'AiProviderNotConfiguredError';
  }
}

function toPayloadMessage(msg: AiMessage): OpenAiMessage {
  if (msg.role === 'tool') {
    return { role: 'tool', content: msg.content, tool_call_id: msg.tool_call_id, name: msg.name };
  }
  if (msg.role === 'assistant') {
    const tool_calls = (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    }));
    return {
      role: 'assistant',
      content: msg.content || null,
      ...(tool_calls.length ? { tool_calls } : {}),
    };
  }
  if (msg.role === 'system' || msg.role === 'user') {
    return { role: msg.role, content: msg.content };
  }
  return { role: 'user', content: msg.content };
}

export class OpenAiCompatibleProvider implements AIProvider {
  async chat(input: ProviderChatInput): Promise<ProviderChatOutput> {
    if (!isAiConfigured) {
      throw new AiProviderNotConfiguredError();
    }

    const tools = input.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const res = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: input.messages.map(toPayloadMessage),
        tools,
        tool_choice: 'auto',
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const detail = text.slice(0, 300);
      throw new Error(
        `Layanan AI tidak merespons (${res.status})${detail ? `: ${detail}` : ''}.`
      );
    }

    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: OpenAiMessage }[];
    } | null;
    const message = json?.choices?.[0]?.message;
    if (!message) {
      throw new Error('Layanan AI tidak mengembalikan jawaban.');
    }

    const toolCalls: ToolCall[] = (message.tool_calls ?? [])
      .filter((tc) => tc.function?.name)
      .map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments ?? '{}') as Record<string, unknown>;
        } catch {
          args = {};
        }
        return { id: tc.id, name: tc.function.name as string, arguments: args };
      });

    return { content: message.content ?? '', toolCalls };
  }
}
