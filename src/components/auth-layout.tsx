/**
 * @fileoverview
 * This component provides a consistent layout for authentication pages (Login, Register).
 * It centers the content vertically and horizontally on the page and displays the
 * application logo and name above the authentication forms.
 * This ensures a uniform look and feel for the user authentication experience.
 */
"use client";

import { Logo } from "./logo";
import Link from "next/link";
import React from "react";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-muted/20 p-4">
      <div className="mb-8 flex items-center gap-2 text-2xl font-bold text-foreground">
        <Logo className="w-16 h-16 text-primary" />
        Treelab
      </div>
      {children}
    </div>
  );
}
