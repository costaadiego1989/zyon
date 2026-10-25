import React from "react";
import { AsaasSubaccountForm, type AsaasSubaccountPayload, type CompanyPrefill } from "./AsaasSubaccountForm.js";

export type AsaasConnectionPayload = AsaasSubaccountPayload;

interface Props {
  company: CompanyPrefill | null;
  defaultName?: string;
  saving: boolean;
  onSubmit: (payload: AsaasConnectionPayload) => void;
  onCancel: () => void;
}

export function AsaasConnectionForm(props: Props) {
  return <AsaasSubaccountForm {...props} />;
}
