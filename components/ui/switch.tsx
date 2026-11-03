"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

// Accessible on/off switch (role="switch"); no extra dependency.
const Switch = React.forwardRef<HTMLButtonElement, Props>(({ className, checked, onCheckedChange, disabled, ...props }, ref) => (
  <button
    ref={ref} type="button" role="switch" aria-checked={checked} disabled={disabled}
    onClick={() => onCheckedChange?.(!checked)}
    className={cn(
      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      checked ? "bg-emerald-700" : "bg-muted-foreground/30", className,
    )}
    {...props}
  >
    <span className={cn("pointer-events-none block h-4 w-4 rounded-full bg-background shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
  </button>
));
Switch.displayName = "Switch";

export { Switch };
