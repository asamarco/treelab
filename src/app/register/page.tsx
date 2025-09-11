/**
 * @fileoverview
 * This file defines the Registration page for the application.
 * It provides a form for new users to sign up by providing a username, email,
 * and password.
 *
 * The component manages its own state for input fields and loading status.
 * It uses the `useAuthContext` to call the `register` function. It handles
 * potential registration failures (e.g., username or email already exists) by
 * displaying a toast notification. It is wrapped in the `AuthLayout`.
 */
"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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


export default function RegisterPage() {
  const { register, globalSettings, isAuthLoading, isAuthRequired } = useAuthContext();
  const { toast } = useToast();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const success = await register(username, password);
    if (!success) {
      toast({
        variant: "destructive",
        title: "Registration Failed",
        description: "An account with this username already exists.",
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
            <CardTitle className="text-2xl">Registration Disabled</CardTitle>
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
  
  if (!isClient) {
    return null; 
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sign Up</CardTitle>
          <CardDescription>
            Enter your information to create an account
          </CardDescription>
        </CardHeader>
        <CardContent>
        {globalSettings.allowPublicRegistration ? (
          <form
            onSubmit={handleRegister}
            className="grid gap-4"
            suppressHydrationWarning
          >
             <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="Your name"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
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
              {isLoading ? "Creating account..." : "Create an account"}
            </Button>
          </form>
          ) : (
            <div className="text-center text-muted-foreground p-4 bg-muted rounded-md">
                Public registration is disabled by the administrator.
            </div>
          )}
          <div className="mt-4 text-center text-sm">
            Already have an account?{" "}
            <Link href="/login" className="underline">
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
