
"use client"

import * as React from "react"
import { format } from "date-fns"
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

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? formatDate(date, displayFormat) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => {
            setDate(d ? format(d, 'yyyy-MM-dd') : undefined);
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
                    setIsOpen(false);
                }}
                className="text-destructive hover:text-destructive"
            >
                <X className="h-4 w-4 mr-1"/>
                Clear
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
                Close
            </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
