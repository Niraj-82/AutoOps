import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import AdvisoryBanner from "@/components/shared/AdvisoryBanner";
import "./globals.css";

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AutoOps Command Center",
  description: "Frontend for the AutoOps multi-agent onboarding automation system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${geistMono.variable} min-h-screen bg-background text-foreground font-sans antialiased`}>
        <AdvisoryBanner />
        {children}
      </body>
    </html>
  );
}
