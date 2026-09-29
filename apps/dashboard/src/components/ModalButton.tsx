import React from "react";
import { Button } from "./Button.js";
export interface ModalButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: "primary" | "secondary"; loading?: boolean; children: React.ReactNode; }
export function ModalButton({ variant = "secondary", ...props }: ModalButtonProps) { return <Button variant={variant === "primary" ? "primary" : "outline"} {...props} />; }
