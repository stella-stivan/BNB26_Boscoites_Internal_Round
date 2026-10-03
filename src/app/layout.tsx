import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fair Drop | One fair entry",
  description: "A limited-seat ticket sale demo with one entry per account and a transparent waiting room.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
