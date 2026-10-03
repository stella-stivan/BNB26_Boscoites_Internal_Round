import { notFound } from "next/navigation";
import { QueueExperience } from "@/components/fairdrop/QueueExperience";
import { getEvent } from "@/lib/event";

export const dynamic = "force-dynamic";
export default async function ProtectedQueuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event || event.access_mode !== "PROTECTED") notFound();
  return <QueueExperience eventId={id} homeHref={`/protected/${id}`} authHref={`/protected/${id}#protected-auth`} />;
}
