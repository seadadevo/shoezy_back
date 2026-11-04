import { prisma } from "../config/database";
import { requeueExhaustedNotification } from "../modules/notifications/notifications.recovery";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main() {
  const eventId = process.argv[2];
  if (!eventId || !UUID.test(eventId)) {
    throw new Error("Usage: npm run notifications:retry -- <exhausted-event-uuid>");
  }

  const result = await requeueExhaustedNotification(prisma, eventId);
  console.info("Notification outbox event requeued", result);
}

main()
  .catch((error: unknown) => {
    console.error("Notification outbox recovery failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      reason: error instanceof Error ? error.message : "Unknown failure",
    });
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
