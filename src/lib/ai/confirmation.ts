/**
 * Confirmation guard — SERVER-ONLY.
 *
 * The `confirmed: true` value in the browser is NOT authorization. When the
 * model requests a write action, the server stores a single-use pending
 * record bound to the authenticated user, the exact action/target/validated
 * parameters, with a high-entropy token and a short expiry. The write is
 * executed only after the client returns that same token and the server
 * re-validates permission + parameters.
 *
 * State is kept in-process (a single Next.js Node server keeps it for the
 * session lifetime). A process restart simply invalidates outstanding
 * confirmations — the user just re-asks.
 */

import { randomUUID } from 'node:crypto';
import type { AiMessage, PendingAction, ToolCall } from './types';

const CONFIRMATION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const store = new Map<string, PendingAction>();

/** Create a pending confirmation, returns the single-use token. */
export function createPendingConfirmation(
  userId: string,
  action: string,
  target: string,
  params: Record<string, unknown>,
  assistantMessage: AiMessage,
  toolCall: ToolCall
): string {
  const token = randomUUID();
  store.set(token, {
    token,
    userId,
    action,
    target,
    params,
    assistantMessage,
    toolCall,
    createdAt: Date.now(),
  });
  return token;
}

export class ConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmationError';
  }
}

/**
 * Consume (single-use) a pending confirmation for the given user.
 * Throws when the token is unknown, expired, or belongs to another user.
 */
export function consumePendingConfirmation(
  token: string,
  userId: string
): PendingAction {
  const pending = store.get(token);
  if (!pending) {
    throw new ConfirmationError(
      'Konfirmasi tidak ditemukan atau sudah kedaluwarsa. Silakan minta tindakan lagi.'
    );
  }
  if (pending.userId !== userId) {
    // Someone else's token — never reveal it exists.
    store.delete(token);
    throw new ConfirmationError('Konfirmasi tidak valid untuk sesi ini.');
  }
  if (Date.now() - pending.createdAt > CONFIRMATION_TTL_MS) {
    store.delete(token);
    throw new ConfirmationError('Konfirmasi sudah kedaluwarsa. Silakan coba lagi.');
  }
  store.delete(token); // single-use
  return pending;
}

/** Used by tests / diagnostics: number of outstanding confirmations. */
export function pendingCount(): number {
  return store.size;
}
