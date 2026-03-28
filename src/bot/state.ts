export type Step = 'TITLE' | 'DATE' | 'LIMIT';

export interface DialogState {
  step: Step;
  title?: string;
  datetime?: Date;
}

const states = new Map<string, DialogState>();

export function getKey(userId: string, chatId: string) {
  return `${userId}_${chatId}`;
}
export function getState(userId: string, chatId: string): DialogState | undefined {
  return states.get(getKey(userId, chatId));
}
export function setState(userId: string, chatId: string, state: DialogState) {
  states.set(getKey(userId, chatId), state);
}
export function clearState(userId: string, chatId: string) {
  states.delete(getKey(userId, chatId));
}
