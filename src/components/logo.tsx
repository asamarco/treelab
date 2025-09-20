/**
 * @fileoverview
 * This file defines the `Logo` component for the application.
 * It renders the application's logo, dynamically switching between a custom
 * uploaded logo and the default favicon based on global settings.
 */
"use client";

import React from 'react';
import { useAuthContext } from '@/contexts/auth-context';

export const Logo = ({ className }: { className?: string }) => {
  const { globalSettings } = useAuthContext();
  const logoSrc = globalSettings?.customLogoPath ? `/api/logo?v=${new Date(globalSettings.updatedAt || Date.now()).getTime()}` : '/favicon.svg';

  return (
    <img 
        src={logoSrc} 
        alt="Treelab Logo" 
        className={className} 
        onError={(e) => {
            // If the custom logo fails to load, fall back to the default
            const target = e.target as HTMLImageElement;
            if (target.src !== '/favicon.svg') {
                target.onerror = null; // prevent infinite loop if default also fails
                target.src = '/favicon.svg';
            }
        }}
    />
  );
};
