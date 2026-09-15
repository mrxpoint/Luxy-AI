/**
 * Memory layer exports (BLUEPRINT.md §8.4).
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

export {
  ingestLessonChunk,
  ingestNoteChunk,
  syncLessonsToChunks,
  retrieveMemories,
  formatMemoriesForPrompt,
} from './rag.js';
