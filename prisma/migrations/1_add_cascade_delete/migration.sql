-- Insert missing Group records for orphaned Events
INSERT INTO "Group" ("chatId", "title", "adminId", "addedAt")
SELECT DISTINCT e."groupId", 'Без названия', e."createdBy", NOW()
FROM "Event" e
LEFT JOIN "Group" g ON g."chatId" = e."groupId"
WHERE g."chatId" IS NULL;

-- DropForeignKey
ALTER TABLE "Participant" DROP CONSTRAINT IF EXISTS "Participant_eventId_fkey";

-- AddForeignKey with CASCADE
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_groupId_fkey";

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("chatId") ON DELETE RESTRICT ON UPDATE CASCADE;
