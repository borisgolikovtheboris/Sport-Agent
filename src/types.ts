// Общие типы — не зависят от Prisma generate
export interface ParticipantData {
  id: string;
  eventId: string;
  userId: string;
  username: string | null;
  firstName: string;
  status: string;
  joinedAt: Date;
}

export interface EventData {
  id: string;
  groupId: string;
  messageId: number | null;
  title: string;
  datetime: Date;
  maxParticipants: number | null;
  createdBy: string;
  status: string;
  createdAt: Date;
  participants: ParticipantData[];
}
