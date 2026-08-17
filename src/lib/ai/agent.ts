/**
 * AI Agent core — SERVER-ONLY.
 *
 * Flow per turn:
 *   1. Permission (admin) checked by the caller (route handler).
 *   2. Ask the planner (LLM by default) which registered tools to call.
 *   3. READ/ANALYSIS tools execute immediately; results feed back to the
 *      planner until it produces a final answer.
 *   4. ACTION tools are NEVER executed here on first request: the agent
 *      stores a single-use, session-bound pending confirmation and returns
 *      it to the client. The write happens only on a confirmed turn.
 *   5. On confirmation: the pending record is consumed, permission +
 *      parameters are re-validated, the action executes, the audit log is
 *      written, and the planner writes the final confirmation prose.
 *
 * No arbitrary SQL, no service role, no bypass of RLS.
 */

import {
  createPendingConfirmation,
  consumePendingConfirmation,
  ConfirmationError,
} from './confirmation';
import { defaultPlanner, AGENT_SYSTEM_PROMPT, type AIProvider } from './provider';
import { getTool, modelTools } from './tools/registry';
import { actionPreflights, actionHandlers } from './tools/actions';
import { writeAudit } from './audit';
import type {
  AgentContext,
  AgentOptions,
  AgentResult,
  AiMessage,
  ToolActivity,
  ToolCall,
  ToolResult,
} from './types';

const MAX_TOOL_ITERATIONS = 6;
const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4000;

function trimConversation(history: AiMessage[]): AiMessage[] {
  const valid = history.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
  );
  const bounded = valid.map((m) =>
    m.content.length > MAX_MESSAGE_LENGTH
      ? { ...m, content: `${m.content.slice(0, MAX_MESSAGE_LENGTH)}…` }
      : m
  );
  return bounded.slice(-MAX_HISTORY_MESSAGES);
}

function withSystem(history: AiMessage[]): AiMessage[] {
  return [{ role: 'system', content: AGENT_SYSTEM_PROMPT }, ...history];
}

function serializeToolResult(result: ToolResult): string {
  return JSON.stringify(result);
}

function assistantMsgWithToolCalls(content: string, toolCalls: ToolCall[]): AiMessage {
  return { role: 'assistant', content, tool_calls: toolCalls };
}

/** Human-readable label for tool activity. */
function activityLabel(toolName: string): string {
  const labels: Record<string, string> = {
    get_dashboard_summary: 'membaca ringkasan dashboard',
    get_revenue: 'menghitung omzet',
    get_orders: 'membaca pesanan',
    get_order_detail: 'membaca detail pesanan',
    get_products: 'membaca produk',
    get_categories: 'membaca kategori',
    get_inventory: 'membaca inventory',
    get_sales_analytics: 'menganalisis penjualan',
    get_top_products: 'membaca produk terlaris',
    get_low_stock_products: 'memeriksa stok menipis',
    get_customer_summary: 'membaca ringkasan customer',
    get_payment_status: 'memeriksa status pembayaran',
    get_refund_status: 'memeriksa status refund',
    analyze_sales: 'menganalisis penjualan',
    analyze_revenue: 'menganalisis omzet',
    analyze_inventory: 'menganalisis inventory',
    analyze_orders: 'menganalisis pesanan',
    detect_sales_anomaly: 'mendeteksi anomali penjualan',
    detect_low_stock: 'mendeteksi stok menipis',
    generate_business_summary: 'merangkum kondisi bisnis',
    generate_business_recommendations: 'menyusun rekomendasi',
    update_order_status: 'mengubah status pesanan',
    update_product: 'mengubah produk',
    update_marketing_content: 'mengubah konten marketing',
  };
  return labels[toolName] ?? `menjalankan ${toolName}`;
}

function activity(
  tool: string,
  type: 'read' | 'analysis' | 'action',
  status: 'ok' | 'error',
  toolName?: string
): ToolActivity {
  return { tool, type, status, summary: activityLabel(toolName ?? tool), ts: new Date().toISOString() };
}

async function executeTool(
  ctx: AgentContext,
  toolCall: ToolCall,
  toolActivity: ToolActivity[]
): Promise<{ result: ToolResult; message: AiMessage }> {
  const tool = getTool(toolCall.name);
  if (!tool) {
    const result: ToolResult = { ok: false, error: `Tool "${toolCall.name}" tidak dikenal.` };
    toolActivity.push(activity(toolCall.name, 'read', 'error'));
    return { result, message: { role: 'tool', content: serializeToolResult(result), tool_call_id: toolCall.id, name: toolCall.name } };
  }
  const result = await tool.handler(ctx, toolCall.arguments);
  toolActivity.push(activity(toolCall.name, tool.type, result.ok ? 'ok' : 'error'));
  return {
    result,
    message: { role: 'tool', content: serializeToolResult(result), tool_call_id: toolCall.id, name: toolCall.name },
  };
}

export class AiAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiAgentError';
  }
}

/**
 * Run one agent turn. Throws AiAgentError for provider/planner failures so
 * the route can return an honest error (never a fabricated answer).
 */
export async function runAgent(
  ctx: AgentContext,
  opts: AgentOptions,
  provider: AIProvider
): Promise<AgentResult> {
  const planner = opts.planner ?? defaultPlanner(provider);
  const history = trimConversation(opts.messages);
  const toolActivity: ToolActivity[] = [];

  // ------------------------------------------------------------- CONFIRMATION
  if (opts.confirmation?.token) {
    return runConfirmedTurn(ctx, opts, planner, history, toolActivity);
  }

  // ------------------------------------------------------------- NORMAL TURN
  let messages: AiMessage[] = withSystem(history);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const { content, toolCalls } = await planner({ messages, tools: modelTools() });

    if (!toolCalls || toolCalls.length === 0) {
      return { reply: content || 'Tidak ada jawaban.', toolActivity, confirmation: null };
    }

    messages = [...messages, assistantMsgWithToolCalls(content, toolCalls)];

    let finished = true;
    for (const rawToolCall of toolCalls) {
      let toolCall = rawToolCall;
      const tool = getTool(toolCall.name);

      // Unknown tool — surface an error to the model, keep the loop alive.
      if (!tool) {
        const { message } = await executeTool(ctx, toolCall, toolActivity);
        messages = [...messages, message];
        finished = false;
        continue;
      }

      // ACTION — never executed here. Preflight (resolve + validate), then
      // ask for confirmation bound to the RESOLVED parameters.
      if (tool.type === 'action') {
        const preflight = actionPreflights[tool.name];
        if (preflight) {
          const pre = await preflight(ctx, toolCall.arguments);
          if (pre.error) {
            const result: ToolResult = { ok: false, error: pre.error };
            toolActivity.push(activity(tool.name, 'action', 'error'));
            messages = [...messages, { role: 'tool', content: serializeToolResult(result), tool_call_id: toolCall.id, name: tool.name }];
            finished = false;
            continue;
          }
          // Bind the confirmation to the resolved parameters + target.
          toolCall = { ...toolCall, arguments: pre.params ?? toolCall.arguments };
          const target = pre.target ?? actionTargetLabel(tool.name, toolCall.arguments);
          const summary = actionSummary(tool.name, toolCall.arguments, target);
          const token = createPendingConfirmation(
            ctx.userId,
            tool.name,
            target,
            toolCall.arguments,
            assistantMsgWithToolCalls(content, [toolCall]),
            toolCall
          );
          toolActivity.push(activity(tool.name, 'action', 'ok'));
          return {
            reply: summary,
            toolActivity,
            confirmation: { token, action: tool.name, target, summary },
          };
        }
        const target = actionTargetLabel(tool.name, toolCall.arguments);
        const summary = actionSummary(tool.name, toolCall.arguments, target);
        const token = createPendingConfirmation(
          ctx.userId,
          tool.name,
          target,
          toolCall.arguments,
          assistantMsgWithToolCalls(content, [toolCall]),
          toolCall
        );
        toolActivity.push(activity(tool.name, 'action', 'ok'));
        return {
          reply: summary,
          toolActivity,
          confirmation: { token, action: tool.name, target, summary },
        };
      }

      // READ / ANALYSIS — execute now.
      const { message } = await executeTool(ctx, toolCall, toolActivity);
      messages = [...messages, message];
      finished = false;
    }

    if (finished) break;
  }

  // Bounded fallback — should be unreachable in practice.
  return {
    reply: 'Saya tidak dapat menyelesaikan permintaan ini dengan tool yang tersedia. Silakan coba lagi dengan pertanyaan yang lebih spesifik.',
    toolActivity,
    confirmation: null,
  };
}

async function runConfirmedTurn(
  ctx: AgentContext,
  opts: AgentOptions,
  planner: NonNullable<AgentOptions['planner']>,
  history: AiMessage[],
  toolActivity: ToolActivity[]
): Promise<AgentResult> {
  // Server-side confirmation: consume the single-use token bound to this user.
  let pending;
  try {
    pending = consumePendingConfirmation(opts.confirmation!.token, ctx.userId);
  } catch (e) {
    if (e instanceof ConfirmationError) {
      throw new AiAgentError(e.message);
    }
    throw e;
  }

  const tool = getTool(pending.action);
  if (!tool || tool.type !== 'action') {
    throw new AiAgentError('Tindakan tidak valid untuk konfirmasi ini.');
  }

  // Re-validate permission + parameters right before the write.
  const handler = actionHandlers[pending.action];
  if (!handler) {
    throw new AiAgentError('Tindakan tidak tersedia.');
  }
  const preflight = actionPreflights[pending.action];
  if (preflight) {
    const pre = await preflight(ctx, pending.params);
    if (pre.error) {
      throw new AiAgentError(pre.error);
    }
  }

  const result: ToolResult = await handler(ctx, pending.params);
  toolActivity.push(activity(pending.action, 'action', result.ok ? 'ok' : 'error'));

  // Audit (non-fatal on failure).
  await writeAudit(ctx, {
    action: pending.action,
    target: pending.target,
    detail: pending.params as Record<string, unknown>,
    result: result.ok ? 'ok' : `error: ${result.error ?? ''}`,
  });

  // Reconstruct the provider chain so the model can answer truthfully.
  const messages: AiMessage[] = withSystem([
    ...history,
    pending.assistantMessage,
    { role: 'tool', content: serializeToolResult(result), tool_call_id: pending.toolCall.id, name: pending.action },
  ]);

  // If the action failed, don't ask the model to celebrate — honest fallback.
  if (!result.ok) {
    return {
      reply: `Tindakan ${pending.action} gagal: ${result.error ?? 'kesalahan tidak diketahui'}. Tidak ada data yang diubah.`,
      toolActivity,
      confirmation: null,
    };
  }

  try {
    const { content } = await planner({ messages, tools: modelTools() });
    return {
      reply: content || 'Tindakan berhasil dieksekusi.',
      toolActivity,
      confirmation: null,
    };
  } catch {
    // Provider unavailable after a successful write — factual template from
    // the real result (never fabricated data).
    return {
      reply: `✅ ${pending.action.replace(/_/g, ' ')} berhasil dieksekusi untuk ${pending.target}.`,
      toolActivity,
      confirmation: null,
    };
  }
}

function actionTargetLabel(action: string, args: Record<string, unknown>): string {
  const id = args.order_id ?? args.product_id ?? args.id;
  const ref = typeof id === 'string' && id ? id.slice(0, 8).toUpperCase() : '—';
  switch (action) {
    case 'update_order_status':
      return `Pesanan #${ref}`;
    case 'update_product':
      return `Produk #${ref}`;
    case 'update_marketing_content':
      return `Konten #${ref}`;
    default:
      return `#${ref}`;
  }
}

function actionSummary(action: string, args: Record<string, unknown>, target: string): string {
  switch (action) {
    case 'update_order_status':
      return `Saya akan mengubah status ${target} menjadi "${args.status}". Lanjutkan?`;
    case 'update_product': {
      const changes = Object.entries(args)
        .filter(([k]) => k !== 'product_id')
        .map(([k, v]) => `${k} = ${v === null ? 'null' : String(v)}`)
        .join(', ');
      return `Saya akan mengubah ${target}: ${changes || 'tidak ada perubahan'}. Lanjutkan?`;
    }
    case 'update_marketing_content': {
      const changes = Object.entries(args)
        .filter(([k]) => k !== 'id')
        .map(([k, v]) => `${k} = ${v === null ? 'null' : String(v)}`)
        .join(', ');
      return `Saya akan mengubah ${target}: ${changes || 'tidak ada perubahan'}. Lanjutkan?`;
    }
    default:
      return `Saya akan menjalankan ${action.replace(/_/g, ' ')}. Lanjutkan?`;
  }
}
