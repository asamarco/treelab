/**
 * @fileoverview
 * This is the main server component for the application's root page.
 * It ensures the user is authenticated and then renders the client-side
 * TreePage component which contains the main application logic.
 */
"use client";
import { ProtectedRoute } from "@/components/protected-route";
import { TreePage } from "./page-client";

function HomePage() {
  return (
    <ProtectedRoute>
      <TreePage />
    </ProtectedRoute>
  );
}

export default HomePage;
