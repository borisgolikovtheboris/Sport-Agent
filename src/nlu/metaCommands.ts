export type MetaCommand = "cancel" | "skip" | "help" | null;

const CANCEL_WORDS = [
  "отмени", "отмена", "стоп", "стой", "хватит", "не надо",
  "забудь", "отбой", "cancel", "stop", "назад", "выйти",
];
const SKIP_WORDS = [
  "пропусти", "пропустить", "скип", "дальше", "нет",
  "без этого", "не нужно", "skip", "next",
];
const HELP_WORDS = [
  "помощь", "help", "что делать", "не понимаю", "как",
];

export function detectMetaCommand(text: string): MetaCommand {
  const normalized = text.trim().toLowerCase();
  if (CANCEL_WORDS.some((w) => normalized === w || normalized.startsWith(w + " "))) return "cancel";
  if (SKIP_WORDS.some((w) => normalized === w || normalized.startsWith(w + " "))) return "skip";
  if (HELP_WORDS.some((w) => normalized === w || normalized.startsWith(w + " "))) return "help";
  return null;
}
