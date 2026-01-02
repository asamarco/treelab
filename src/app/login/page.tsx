/**
 * @fileoverview
 * This file defines the Login page for the application.
 * It provides a form for users to sign in using their email/username and password.
 *
 * The component manages its own state for input fields and loading status.
 * It uses the `useAuthContext` to call the `login` function and handles both
 * successful and failed login attempts, showing a toast notification on failure.
 * It is wrapped in the `AuthLayout`.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthContext } from "@/contexts/auth-context";
import { AuthLayout } from "@/components/auth-layout";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const { login, isAuthRequired, isAuthLoading } = useAuthContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const success = await login(identifier, password);
    if (success) {
      const redirectUrl = searchParams.get('redirect');
      // HARDENING: Sanitize redirect URL to prevent open redirect and XSS vulnerabilities.
      // It must be a relative path within the application and cannot contain protocol schemes.
      const isSafeRedirect = redirectUrl && redirectUrl.startsWith('/') && !redirectUrl.startsWith('//') && !redirectUrl.includes(':');

      if (isSafeRedirect) {
        router.push(redirectUrl);
      } else {
        router.push("/");
      }
    } else {
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: "Invalid credentials. Please try again.",
      });
      setIsLoading(false);
    }
  };

  if (isAuthLoading) {
    return null; // or a loading skeleton
  }
  
  if (!isAuthRequired) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl">Login Disabled</CardTitle>
            <CardDescription>
              Authentication is not required for this application.
            </CardDescription>
          </CardHeader>
          <CardContent>
             <Button onClick={() => router.push('/')} className="w-full">
                Continue to App
            </Button>
          </CardContent>
        </Card>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>
            Enter your username or email below to login to your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleLogin}
            className="grid gap-4"
            suppressHydrationWarning
          >
            <div className="grid gap-2">
              <Label htmlFor="identifier">Username or Email</Label>
              <Input
                id="identifier"
                type="text"
                placeholder="your_username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="underline">
              Sign up
            </Link>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
