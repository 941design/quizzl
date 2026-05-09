/**
 * chatHandler.ts
 *
 * RumorHandler for CHAT_MESSAGE_KIND (kind 9).
 *
 * Receives all side-effect dependencies via the deps bag injected at
 * buildDispatcher(deps) time — no React context imports, no direct IDB imports.
 *
 * Boundary rules (architecture.md):
 *   - Zero imports from app/src/context/
 *   - All IDB and state-setter deps received via injection
 */

import { CHAT_MESSAGE_KIND } from '@/src/lib/marmot/chatPersistence';
import type { ChatMessage } from '@/src/lib/marmot/chatPersistence';
import type { ApplicationRumor, DispatcherContext, RumorHandler } from '@/src/lib/marmot/applicationRumorDispatcher';

export interface ChatHandlerDeps {
  appendMessage: (groupId: string, message: ChatMessage) => Promise<void>;
  incrementUnread: (groupId: string) => void;
  setChatVersion: (updater: (v: number) => number) => void;
}

async function handle(rumor: ApplicationRumor, ctx: DispatcherContext, deps: ChatHandlerDeps): Promise<void> {
  const { parseImageMessageContent, extractAttachmentsByRole } = await import('@/src/lib/media/imageMessage');
  const parsed = parseImageMessageContent(typeof rumor.content === 'string' ? rumor.content : '');
  const attachments = (parsed?.type === 'image' && rumor.tags?.length)
    ? extractAttachmentsByRole(rumor.tags)
    : null;
  const hasAttachment = attachments && (attachments.full || attachments.thumb);

  const msg: ChatMessage = {
    id: rumor.id,
    content: typeof rumor.content === 'string' ? rumor.content : '',
    senderPubkey: rumor.pubkey,
    groupId: ctx.groupId,
    createdAt: rumor.created_at * 1000,
    ...(hasAttachment ? { attachments } : {}),
  };

  await deps.appendMessage(ctx.groupId, msg);
  deps.setChatVersion((v) => v + 1);

  // Own-send guard: skip incrementUnread for messages sent by the local user.
  // marmot-ts #sentEventIds prevents own-send from reaching the bus at all,
  // but this guard provides defense-in-depth.
  if (rumor.pubkey !== ctx.selfPubkeyHex) {
    deps.incrementUnread(ctx.groupId);
  }
}

export function createChatHandler(deps: ChatHandlerDeps): RumorHandler {
  return {
    kind: CHAT_MESSAGE_KIND,
    handle: (rumor: ApplicationRumor, ctx: DispatcherContext) => handle(rumor, ctx, deps),
  };
}
