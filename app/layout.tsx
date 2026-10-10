import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Daily Diary | VitalFlow",
  description: "A calm personal diary to record daily activities and reflect on your routines.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
