import "@fontsource-variable/inter";
import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Poly Trend V3 — Event Research Desk",
  description:
    "Follow event repricing, investigate asset consequences, and test what would change your thesis.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
