
"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface ComboboxProps {
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyPlaceholder?: string;
}

export function Combobox({ 
    options, 
    value, 
    onChange, 
    placeholder = "Select an option...",
    searchPlaceholder = "Search options...",
    emptyPlaceholder = "No option found." 
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const filteredOptions = options.filter(option => option.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value
            ? options.find((option) => option.value === value)?.label ?? value
            : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command shouldFilter={false}>
          <CommandInput 
            placeholder={searchPlaceholder} 
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={(currentValue) => {
                    const selectedOption = options.find(o => o.value.toLowerCase() === currentValue.toLowerCase());
                    onChange(selectedOption ? selectedOption.value : "")
                    setQuery("")
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {query && filteredOptions.length === 0 && (
                 <CommandItem
                    value={query}
                    onSelect={(currentValue) => {
                        onChange(currentValue)
                        setQuery("")
                        setOpen(false)
                    }}
                    >
                    Create "{query}"
                 </CommandItem>
            )}
            {!query && filteredOptions.length === 0 && (
                <CommandEmpty>{emptyPlaceholder}</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
