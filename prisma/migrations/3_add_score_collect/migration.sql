-- AlterEnum
ALTER TYPE "ReminderType" ADD VALUE 'SCORE_COLLECT';

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN "score" INTEGER;
