

"use client";

import { useAuthContext } from "@/contexts/auth-context";
import { TreeFile } from "@/lib/types";
import { useEffect } from "react";
import { cn } from "@/lib/utils";


export function PublicViewWrapper({ tree, children }: { tree: TreeFile, children: React.ReactNode }) {
    const { currentUser } = useAuthContext();

    const canEdit = currentUser && (tree.userId === currentUser.id || tree.sharedWith?.includes(currentUser.id));
    
    // We apply a class to a wrapper div instead of the body to prevent styles
    // from leaking across page navigations.
    const wrapperClassName = canEdit ? '' : 'read-only-view';

    return <div className={wrapperClassName}>{children}</div>;
}
