import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { ActivityBar } from "./components/activity-bar";
import { LANG_COOKIE, isLang, isRtl, langFromHeader } from "@/lib/i18n/core";
import { I18nProvider } from "@/lib/i18n/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Store Replenishment Mini App",
  description: "Telegram mini app flow for hall scan and warehouse picking",
  // Default label for the iOS home-screen bookmark (icon: app/apple-icon.tsx).
  appleWebApp: { title: "REPL" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The chosen language lives in a cookie; before a choice, the phone's language.
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  const lang = isLang(saved) ? saved : langFromHeader((await headers()).get("accept-language"));
  return (
    <html lang={lang} dir={isRtl(lang) ? "rtl" : "ltr"} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <I18nProvider initialLang={lang}>
          <ActivityBar />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
