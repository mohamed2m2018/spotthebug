import type { Metadata } from "next";
import { Inter, Fira_Code } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const firaCode = Fira_Code({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SpotTheBug.ai — AI Voice Code Review Training",
  description:
    "Train your code review skills with an AI voice mentor. Practice finding real bugs from open source projects. The #1 platform for developers who want to think critically about AI-generated code.",
  keywords: [
    "code review training",
    "AI mentor",
    "developer training",
    "bug finding",
    "voice AI",
    "code quality",
  ],
  openGraph: {
    title: "SpotTheBug.ai — AI Voice Code Review Training",
    description:
      "Train your code review skills with an AI voice mentor. Real bugs. Real skills.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${firaCode.variable}`} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
