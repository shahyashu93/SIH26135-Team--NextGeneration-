import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("button", { variants: { variant: { default: "button-primary", outline: "button-outline", ghost: "button-ghost", destructive: "button-danger" }, size: { default: "", sm: "button-sm", icon: "button-icon" } }, defaultVariants: { variant: "default", size: "default" } });
function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : "button";
  return <Component data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
export { Button, buttonVariants };