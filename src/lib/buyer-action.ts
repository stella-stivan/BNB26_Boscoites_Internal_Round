import type { BuyerState, EventRow } from "./event";

export type BuyerAction = { label: string; href?: string; join?: boolean; disabled?: boolean };

export function getBuyerAction(event: EventRow, buyer: BuyerState): BuyerAction {
  if (buyer.state === "NOT_SIGNED_IN") return { label: "Choose a demo account", href: "#demo-account" };
  if (buyer.state === "REVIEW_REQUIRED") return { label: "Awaiting organizer review", disabled: true };
  if (buyer.state === "BLOCKED") return { label: "Contact organizer", disabled: true };
  if (buyer.state === "CONFIRMED") return { label: "View my ticket", href: "/queue" };
  if (buyer.state === "RESERVED") return { label: "Continue checkout", href: "/queue" };
  if (["QUEUED", "ADMITTED"].includes(buyer.state)) return { label: "View my status", href: "/queue" };
  if (event.status === "ENTRY_OPEN" && Date.now() >= new Date(event.entry_opens_at).getTime() && Date.now() < new Date(event.entry_closes_at).getTime()) {
    return { label: "Join waiting room", join: true };
  }
  return { label: event.status === "SOLD_OUT" ? "Sold out" : "Entry is closed", disabled: true };
}
