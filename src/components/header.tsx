
/**
 * @fileoverview
 * Defines the main application header component, `AppHeader`.
 * It displays the application logo and name, primary navigation links,
 * and a user dropdown menu. The header is responsive, collapsing navigation
 * links into the user menu on smaller screens.
 */
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, User as UserIcon, Settings, Library, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthContext } from "@/contexts/auth-context";
import { Button } from "./ui/button";
import { Logo } from "./logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { useToast } from "@/hooks/use-toast";

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, logout, isAuthRequired, theme, setTheme } = useAuthContext();
  const { toast } = useToast();

  const navItems = [
    { href: "/", label: "My Tree" },
    { href: "/templates", label: "Templates" },
    { href: "/roots", label: "Roots" },
  ];

  if (!currentUser) {
    return null; // Don't render header on auth pages
  }
  
  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  const handleThemeChange = (isDark: boolean) => {
    const newTheme = isDark ? 'dark' : 'light';
    setTheme(newTheme);
    toast({
        title: `Switched to ${newTheme} mode`,
    });
  }

  const isDarkMode = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header className="bg-card/80 backdrop-blur-sm border-b sticky top-0 z-10">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-bold text-foreground"
          >
            <Logo className="w-12 h-12 text-primary" />
            Treelab
          </Link>
          <nav className="hidden md:flex items-center gap-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-primary",
                  pathname === item.href || (item.href === "/roots" && pathname.startsWith("/manage-trees"))
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
             <div className="flex items-center gap-1 rounded-full p-1 bg-muted">
                <Button variant={!isDarkMode ? 'secondary' : 'ghost'} size="icon" className="h-6 w-6 rounded-full" onClick={() => handleThemeChange(false)}>
                    <Sun className="h-4 w-4" />
                </Button>
                <Button variant={isDarkMode ? 'secondary' : 'ghost'} size="icon" className="h-6 w-6 rounded-full" onClick={() => handleThemeChange(true)}>
                    <Moon className="h-4 w-4" />
                </Button>
            </div>
             <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-8 w-8 rounded-full"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>
                      {currentUser.username?.[0].toUpperCase() ?? <UserIcon/>}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {currentUser.username}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="md:hidden">
                  {navItems.map((item) => (
                    <DropdownMenuItem key={item.href} asChild>
                       <Link
                        href={item.href}
                        className={cn(
                          "w-full",
                          pathname === item.href && "bg-accent"
                        )}
                      >
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                   <DropdownMenuSeparator />
                </div>
                 <DropdownMenuItem asChild>
                    <Link href="/settings">
                        <Settings className="mr-2 h-4 w-4" />
                        <span>Settings</span>
                    </Link>
                </DropdownMenuItem>
                {isAuthRequired && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout}>
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Log out</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
