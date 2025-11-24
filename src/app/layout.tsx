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
import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/contexts/auth-context";
import { TreeProvider } from "@/contexts/tree-roots";
import { UIProvider } from "@/contexts/ui-context";
import { Toaster } from "@/components/ui/toaster";
import { unstable_noStore as noStore } from 'next/cache';
import fs from 'fs';
import path from 'path';

export const metadata: Metadata = {
  title: "Treelab",
  description: "Create and manage data trees with custom templates.",
  icons: {
    icon: "/favicon.svg",
  },
};

interface AppConfig {
    REQUIRE_AUTHENTICATION?: boolean;
    USERID?: string;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  noStore();
  
  // Read configuration from config.json
  const configPath = path.join(process.cwd(), 'config.json');
  let appConfig: AppConfig = {};
  try {
    const configFile = fs.readFileSync(configPath, 'utf8');
    appConfig = JSON.parse(configFile);
  } catch (error) {
    console.error("Could not read or parse config.json, using defaults.", error);
  }
  
  const isAuthRequired = appConfig.REQUIRE_AUTHENTICATION ?? true;
  const defaultUserId = appConfig.USERID || "test";

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=1024" />
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
        >
          <UIProvider>
            <TreeProvider>
              {children}
              <Toaster />
            </TreeProvider>
          </UIProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
