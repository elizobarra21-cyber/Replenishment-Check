import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Store Replenishment Mini App",
  description: "Telegram mini app flow for hall scan and warehouse picking",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
