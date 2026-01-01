/**
 * @fileoverview
 * This component displays a banner on public pages to inform users that
 * their changes will not be saved.
 */
"use client";

import { useAuthContext } from "@/contexts/auth-context";
import { Info } from "lucide-react";

export function PublicViewBanner() {
  const { currentUser } = useAuthContext();

  // If there's a logged-in user, don't show the banner.
  if (currentUser) {
    return null;
  }

  return (
    <div className="bg-accent text-accent-foreground p-2 text-center text-sm flex items-center justify-center gap-2">
      <Info className="h-4 w-4" />
      <span>This is a public view. Changes will not be saved.</span>
    </div>
  );
}
