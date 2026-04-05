export function shouldRunNLU(text: string, context: {
  hasActiveConversation: boolean;
  isReplyToBot: boolean;
}): boolean {
  const normalized = text.trim().toLowerCase();

  // Stop patterns: definitely NOT a create command
  const stopPatterns = [
    /^\d+\s*(руб|₽|р)\b/i,                // "500 руб ..." — price discussion
    /^(сколько|почём|какая цена)/i,        // price question
    /^(кто|сколько)\s+(был|ходил|играл)/i, // question about past
    /^(да|нет|ок|ладно|хорошо|понял)$/i,   // confirmation
  ];
  if (stopPatterns.some((p) => p.test(normalized))) return false;

  // If user is in an active conversation — NLU not needed
  if (context.hasActiveConversation) return false;

  return true;
}
