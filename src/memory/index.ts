/**
 * Memory layer exports (BLUEPRINT.md §8.4).
 * RAG (pgvector) hooks land in a follow-up; conversation is available now.
 */
export {
  getOrCreateSession,
  startNewSession,
  appendMessage,
  loadRecentMessages,
  type ChatChannel,
  type ChatRole,
  type ChatMessage,
} from './conversation.js';
