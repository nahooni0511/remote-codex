import type { ButtonHTMLAttributes } from "react";

import styles from "./Button.module.css";

type ButtonVariant = "primary" | "secondary" | "ghost" | "icon";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  fullWidth?: boolean;
};

export function Button({ variant = "primary", fullWidth = false, className = "", ...props }: Props) {
  return (
    <button
      className={[styles.button, styles[variant], fullWidth ? styles.fullWidth : "", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
