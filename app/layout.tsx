import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GWEEN | Private Daily Journal",
  description: "Your profile, your pages, your pace. A private daily journal with encrypted local notes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
