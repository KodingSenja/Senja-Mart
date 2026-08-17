import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from 'lib/supabase/server';
import { runAgent, AiAgentError } from 'lib/ai/agent';
import { isAdminUser } from 'lib/ai/permissions';
import { isAiConfigured } from 'lib/ai/config';
import { OpenAiCompatibleProvider, AiProviderNotConfiguredError } from 'lib/ai/provider/openai-compatible';
import type { AiMessage } from 'lib/ai/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/chat
 *
 * Body: { messages: AiMessage[], confirmation?: { token: string } }
 *
 * Server-side only. The OpenRouter key never leaves this module; Supabase
 * queries/writes run through the signed-in user's own session (RLS is the
 * enforcement layer). Only admins may call this endpoint.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      messages?: unknown;
      confirmation?: { token?: unknown };
    } | null;

    if (!body || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: 'Format permintaan tidak valid.' }, { status: 400 });
    }
    const confirmation =
      typeof body.confirmation?.token === 'string' && body.confirmation.token.length > 0
        ? { token: body.confirmation.token }
        : undefined;

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Silakan masuk terlebih dahulu.' }, { status: 401 });
    }

    const admin = await isAdminUser(supabase);
    if (!admin) {
      return NextResponse.json(
        { error: 'Akses ditolak — hanya akun admin yang dapat menggunakan AI Business Assistant.' },
        { status: 403 }
      );
    }

    if (!isAiConfigured) {
      return NextResponse.json(
        {
          reply:
            'AI Business Assistant belum dikonfigurasi: OPENROUTER_API_KEY belum diisi di server. Hubungi admin untuk mengaktifkannya.',
          toolActivity: [],
          confirmation: null,
        },
        { status: 200 }
      );
    }

    const messages = (body.messages as AiMessage[]).filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string'
    );

    const provider = new OpenAiCompatibleProvider();
    const result = await runAgent(
      { supabase, userId: user.id },
      { messages, confirmation },
      provider
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AiAgentError || err instanceof AiProviderNotConfiguredError) {
      return NextResponse.json(
        { error: err.message, toolActivity: [], confirmation: null },
        { status: 200 }
      );
    }
    const message =
      err instanceof Error ? err.message : 'Terjadi kesalahan pada AI Business Assistant.';
    return NextResponse.json(
      { error: `Maaf, saya tidak dapat memproses permintaan ini: ${message}`, toolActivity: [], confirmation: null },
      { status: 200 }
    );
  }
}
