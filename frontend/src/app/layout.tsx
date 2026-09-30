import type { Metadata } from "next";
import { Manrope, Playfair_Display, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthContext";

// Body/UI text - warmer and more distinctive than a plain grotesque, still highly legible
// at small sizes across a data-dense screen.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
// Brand wordmark, page titles and section headings - the "luxury" signal. Used sparingly
// (never body copy, never table cells) so it reads as considered rather than decorative.
const playfairDisplay = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair" });
// KPI numbers, table figures and IDs - an "instrument panel" precision cue.
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "Universal MyWFM",
  description: "Workforce Management Control Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${playfairDisplay.variable} ${jetbrainsMono.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
