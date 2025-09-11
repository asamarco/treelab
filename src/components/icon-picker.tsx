/**
 * @fileoverview
 * Defines the `IconPicker` component, a user-friendly interface for selecting an icon.
 * It consists of a button that, when clicked, opens a popover displaying a searchable,
 * scrollable grid of all available `lucide-react` icons. This component is used in
 * the Template Designer to allow users to assign a visual icon to their templates.
 */
"use client";

import * as React from "react";
import { icons } from "lucide-react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { Input } from "./ui/input";

const iconNames = Object.keys(icons) as (keyof typeof icons)[];

interface IconPickerProps {
    value?: string;
    onChange: (iconName: string) => void;
    className?: string;
}

export function IconPicker({ value, onChange, className }: IconPickerProps) {
    const [isOpen, setIsOpen] = React.useState(false);
    const [search, setSearch] = React.useState("");

    const filteredIcons = React.useMemo(() => {
        if (!search) return iconNames;
        return iconNames.filter((name) => 
            name.toLowerCase().includes(search.toLowerCase())
        );
    }, [search]);


    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className={cn("w-full justify-start gap-2", className)}
                >
                    {value ? (
                        <>
                            <Icon name={value as keyof typeof icons} className="h-4 w-4" />
                            <span>{value}</span>
                        </>
                    ) : (
                        "Select an icon"
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0">
                <div className="p-2 border-b">
                    <Input 
                        placeholder="Search icons..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-9"
                    />
                </div>
                <ScrollArea className="h-72">
                    <div className="grid grid-cols-6 gap-1 p-2">
                        {filteredIcons.map((iconName) => (
                            <Button
                                key={iconName}
                                variant={value === iconName ? "default" : "ghost"}
                                size="icon"
                                onClick={() => {
                                    onChange(iconName);
                                    setIsOpen(false);
                                    setSearch("");
                                }}
                                className="h-8 w-8"
                            >
                                <Icon name={iconName} className="h-4 w-4" />
                            </Button>
                        ))}
                    </div>
                </ScrollArea>
            </PopoverContent>
        </Popover>
    );
}
