import type { Metadata } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthContext";

// The one typeface throughout - body copy and headings alike (headings just go bolder/tighter,
// see .font-display in globals.css). One professional sans-serif, used consistently, rather
// than pairing in a second display face.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
// KPI numbers, table figures and IDs - an "instrument panel" precision cue.
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "Universal MyWFM",
  description: "Workforce Management Control Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${jetbrainsMono.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
