"use client"

import * as React from "react"
import { format, parse, isValid } from "date-fns"
import { Calendar as CalendarIcon, X } from "lucide-react"
import { useAuthContext } from "@/contexts/auth-context"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/utils"

interface DatePickerProps {
  date: Date | undefined;
  setDate: (dateString: string | undefined) => void;
  placeholder: string;
  className?: string;
}

export function DatePicker({ date, setDate, placeholder, className }: DatePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const { dateFormat } = useAuthContext();
  const displayFormat = dateFormat || 'dd/MM/yyyy';
  const containerRef = React.useRef<HTMLDivElement>(null);

  const [inputValue, setInputValue] = React.useState(
    date ? formatDate(date, displayFormat) : ""
  );

  // Synchronize inputValue with external date changes, 
  // but avoid doing it while the user is actively typing (focused within the component).
  React.useEffect(() => {
    const isFocused = containerRef.current?.contains(document.activeElement);
    if (!isFocused) {
      setInputValue(date ? formatDate(date, displayFormat) : "");
    }
  }, [date, displayFormat]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);

    // Try to parse the input based on user's display format
    const parsedDate = parse(value, displayFormat, new Date());
    if (isValid(parsedDate)) {
      // Update parent state but DON'T re-sync inputValue yet to avoid interruption
      setDate(format(parsedDate, 'yyyy-MM-dd'));
    }
  };

  const handleContainerBlur = (e: React.FocusEvent) => {
    // Check if the focus is moving to another element within the same form
    const form = e.currentTarget.closest('form');
    const isMovingToSameForm = !!(e.relatedTarget && form?.contains(e.relatedTarget as Node));

    if (!isMovingToSameForm) {
      // Focus left the entire form (or there is no form), so perform formatting
      if (date) {
        setInputValue(formatDate(date, displayFormat));
      } else if (inputValue === "") {
        setDate(undefined);
      }
    }
  };

  return (
    <div 
      className={cn("relative flex items-center w-full", className)} 
      ref={containerRef}
      onBlur={handleContainerBlur}
    >
      <Input
        value={inputValue}
        onChange={handleInputChange}
        placeholder={placeholder || displayFormat.toLowerCase()}
        className="pr-10 w-full"
      />
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-0 h-full w-10 hover:bg-transparent"
          >
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => {
              setDate(d ? format(d, 'yyyy-MM-dd') : undefined);
              setInputValue(d ? formatDate(d, displayFormat) : "");
              setIsOpen(false);
            }}
            initialFocus
          />
          <div className="p-2 border-t border-border flex justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDate(undefined);
                setInputValue("");
                setIsOpen(false);
              }}
              className="text-destructive hover:text-destructive"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
              Close
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
