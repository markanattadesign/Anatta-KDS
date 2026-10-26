import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Edible KDS",
  description: "Production kitchen display system for made-to-order fruit arrangements",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#14161a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
