import type { RefObject } from "react";

export type ComposerInputMeta = {
  placeholder: string;
  inputType: string;
  inputMode?: string;
  maxLength?: number;
  autoComplete?: string;
  fieldKind:
    | "default"
    | "catalog"
    | "email"
    | "phone"
    | "cpf"
    | "name"
    | "cep"
    | "address"
    | "otp"
    | "number";
};

export type ComposerModel = {
  agentGiven: string;
  message: string;
  busy: boolean;
  composerLocked: boolean;
  inputRef: RefObject<HTMLInputElement>;
  meta: ComposerInputMeta;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
};
