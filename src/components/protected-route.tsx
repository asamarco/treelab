/**
 * @fileoverview
 * This file defines the `ProtectedRoute` component, which acts as a higher-order
 * component (HOC) to restrict access to certain pages to authenticated users only.
 *
 * It checks the authentication status from `useAuthContext`. If the user is not logged in,
 * it redirects them to the login page. While checking the auth status, it displays a
 * skeleton loader to provide a better user experience.
 */
"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthContext } from "@/contexts/auth-context";
import { Skeleton } from "./ui/skeleton";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { currentUser, isAuthRequired, isAuthLoading } = useAuthContext();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Wait until the initial auth check is complete before redirecting.
    if (!isAuthLoading && isAuthRequired && !currentUser) {
      router.push(`/login?redirect=${pathname}`);
    }
  }, [currentUser, isAuthRequired, isAuthLoading, router, pathname]);
  
  // While loading the auth state OR if a redirect is imminent, show the loader.
  if (isAuthLoading || (isAuthRequired && !currentUser)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="space-y-4 w-full max-w-md mx-auto p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
