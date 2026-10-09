import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VitalFlow | Daily Life Tracker",
  description: "Professional daily life tracker and wellness dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
