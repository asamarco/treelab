/**
 * @fileoverview
 * Defines a generic `Icon` component. This component dynamically renders an icon
 * from the `lucide-react` library based on a `name` prop.
 * If the specified icon name does not exist in the library, it gracefully
 * falls back to a default 'FileText' icon, preventing rendering errors.
 * This provides a flexible and robust way to use icons throughout the application.
 */
import type { LucideProps } from 'lucide-react';
import { icons } from 'lucide-react';

interface IconProps extends LucideProps {
  name: keyof typeof icons | string;
}

export const Icon = ({ name, ...props }: IconProps) => {
  const LucideIcon = icons[name as keyof typeof icons];

  if (!LucideIcon) {
    const FallbackIcon = icons['FileText'];
    return <FallbackIcon {...props} />;
  }

  return <LucideIcon {...props} />;
};
