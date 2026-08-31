/**
 * @fileoverview
 * Displays a dismissible one-line warning banner when the user's stored GitHub
 * Personal Access Token has been detected as invalid or expired.
 * Shown below the AppHeader on authenticated pages.
 */
"use client";

import { X, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useAuthContext } from "@/contexts/auth-context";

export function GithubTokenBanner() {
  const { githubTokenStatus, dismissGithubTokenWarning, currentUser } = useAuthContext();

  // Only show when the token is confirmed invalid and a user is logged in.
  if (githubTokenStatus !== "invalid" || !currentUser) {
    return null;
  }

  return (
    <div
      role="alert"
      className="relative flex items-center justify-center gap-2 bg-yellow-50 dark:bg-yellow-950/40 border-b border-yellow-200 dark:border-yellow-800 px-4 py-2 text-sm text-yellow-800 dark:text-yellow-200"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Your GitHub token appears to be invalid or expired.{" "}
        <Link
          href="/settings#git-integration"
          className="font-medium underline underline-offset-2 hover:opacity-80"
        >
          Update it in Settings
        </Link>
        .
      </span>
      <button
        onClick={dismissGithubTokenWarning}
        aria-label="Dismiss GitHub token warning"
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-yellow-500"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
