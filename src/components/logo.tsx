/**
 * @fileoverview
 * This file defines the `Logo` component for the application.
 * It simply renders the application's logo image (`favicon.svg`) from the public
 * directory. It accepts an optional `className` prop to allow for custom styling.
 */
import React from 'react';

export const Logo = ({ className }: { className?: string }) => (
  <img src="/favicon.svg" alt="Treelab Logo" className={className} />
);
