export const NLU_CONFIG = {
  model: "claude-sonnet-4-20250514",
  maxTokens: 300,
  minConfidence: 0.6,
  minConfidenceShortText: 0.8, // for messages <= 3 words
  timeoutMs: 5000,

  strongTriggers: [
    "забей", "забить", "создай", "запланируй", "организуй",
    "го в", "го на", "погнали", "поехали", "кто за", "давайте", "идём",
  ],

  helpTriggers: [
    "как создать", "как записаться", "как отменить", "как пользоваться",
    "что ты можешь", "что ты умеешь", "что умеешь", "как работает",
    "подскажи", "объясни", "инструкция", "помощь",
  ],

  weakTriggers: [
    "тренировка", "трениро", "игра", "матч",
    "футбол", "баскетбол", "волейбол", "бадминтон", "теннис",
    "бег", "пробежка", "йога", "хоккей",
    "плавание", "бассейн", "сквош", "пинг-понг", "настольный теннис",
    "лыжи", "коньки", "велосипед", "покатушк", "скалолаз", "кроссфит",
    "зал ", "спортзал", "качалк", "разминк", "растяжк",
    "завтра", "послезавтра", "сегодня",
    "в среду", "в четверг", "в пятницу", "в субботу", "в воскресенье",
    "в понедельник", "во вторник",
    "по понедельник", "по вторник", "по сред", "по четверг",
    "по пятниц", "по суббот", "по воскресень",
    "каждый", "каждую", "каждое", "еженедельн", "регулярн",
  ],
};

export function shouldTriggerNLU(text: string): boolean {
  const words = text.trim().split(/\s+/);
  const normalized = text.toLowerCase();

  // Strong trigger → always
  if (NLU_CONFIG.strongTriggers.some((t) => normalized.includes(t))) return true;

  // Help trigger → always
  if (NLU_CONFIG.helpTriggers.some((t) => normalized.includes(t))) return true;

  // Weak trigger + length > 3 words → yes
  if (NLU_CONFIG.weakTriggers.some((t) => normalized.includes(t)) && words.length > 3) return true;

  return false;
}
