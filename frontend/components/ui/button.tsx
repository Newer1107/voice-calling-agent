"use client";

import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "ghost" | "outline";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "btn-accent",
  ghost: "btn-ghost",
  outline:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong bg-transparent px-3 py-1.5 text-[13px] font-medium text-ink-mid transition-colors duration-150 hover:bg-white/[0.04] hover:text-ink-high disabled:cursor-not-allowed disabled:opacity-40",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "ghost", className = "", ...props }: ButtonProps) {
  return <button type="button" className={`${VARIANTS[variant]} ${className}`} {...props} />;
}
