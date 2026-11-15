import React from "react";
import { FormTextarea } from "../../components/FormField.js";

export function CompanyAboutField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <FormTextarea label="Sobre a empresa" value={value} onChange={onChange} maxLength={1200} rows={5}
    placeholder="Apresente a empresa, sua atuação e o que seus clientes precisam saber."
    hint={`Texto público usado para apresentar sua empresa e orientar o assistente. Inclua somente informações comerciais. Não inclua dados privados de clientes. ${value.length}/1.200 caracteres.`} />;
}
