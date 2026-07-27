/**
 * @fileoverview
 * This is the root layout for the entire application. It's a server component
 * that wraps all pages.
 *
 * It sets up the basic HTML structure, including the `<html>` and `<body>` tags.
 * It imports the global stylesheet, configures metadata for the site (like title
 * and favicon), loads custom fonts from Google Fonts, and wraps the main content
 * in the `AppProvider` to make the global state available to all components.
 * The `Toaster` component for notifications is also included here.
 */
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/contexts/auth-context";
import { TreeProvider } from "@/contexts/tree-roots";
import { UIProvider } from "@/contexts/ui-context";
import { Toaster } from "@/components/ui/toaster";
import PWARegistry from "@/components/pwa-registry";
import { unstable_noStore as noStore } from 'next/cache';
import fs from 'fs';
import path from 'path';

export const metadata: Metadata = {
  title: "Treelab",
  description: "Create and manage data trees with custom templates.",
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Treelab",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a282b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  noStore();
  
  const isAuthRequired = process.env.REQUIRE_AUTHENTICATION !== 'false';
  const defaultUserId = process.env.USERID || "test";
  const isApiEnabled = process.env.ENABLE_API === 'true';

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="/favicon.svg" sizes="any" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased">
        <AuthProvider
          isAuthRequired={isAuthRequired}
          defaultUserId={defaultUserId}
          isApiEnabled={isApiEnabled}
        >
          <UIProvider>
            <TreeProvider>
              <PWARegistry />
              {children}
              <Toaster />
            </TreeProvider>
          </UIProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
