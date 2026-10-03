import { QueueExperience } from "@/components/fairdrop/QueueExperience";
import { getSeedEventId } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  return <QueueExperience eventId={await getSeedEventId()} />;
}
