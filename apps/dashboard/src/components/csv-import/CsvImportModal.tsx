import React, { useEffect } from "react";
import { Download } from "lucide-react";
import { Modal } from "../Modal.js";
import { Button } from "../Button.js";
import { useCsvImport } from "./hooks/useCsvImport.js";
import { CsvFileDropzone } from "./components/CsvFileDropzone.js";
import { CsvPreviewTable } from "./components/CsvPreviewTable.js";
import { CsvProgressBar } from "./components/CsvProgressBar.js";
import { CsvErrorList } from "./components/CsvErrorList.js";
import type { CsvRow } from "./utils/csv-validation.js";
import "../import-dialog.css";

export interface CsvImportModalProps { isOpen: boolean; onClose: () => void; onImport: (rows: CsvRow[]) => Promise<void>; }
const TEMPLATE_HEADER = "name,sku,price,stock,weight_grams,length_cm,width_cm,height_cm,description,category";
const TEMPLATE_ROWS = ['Produto Exemplo 1,SKU-001,99.99,100,500,10,15,20,"Descrição do produto","Eletrônicos"', 'Produto Exemplo 2,SKU-002,149.50,50,750,12,18,25,"Outro produto","Acessórios"'];
function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([[TEMPLATE_HEADER, ...TEMPLATE_ROWS].join("\n")], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a"); link.href = url; link.download = "modelo-produtos.csv"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CsvImportModal({ isOpen, onClose, onImport }: CsvImportModalProps) {
  const vm = useCsvImport();
  useEffect(() => { if (isOpen) vm.resetAll(); }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = vm.parsedRows.length > 0 && vm.errors.length === 0;
  const stepIndex = vm.step === "upload" ? 1 : vm.step === "preview" ? 2 : 3;
  return <Modal isOpen={isOpen} title={vm.step === "upload" ? "Importar produtos por CSV" : vm.step === "preview" ? "Revisar produtos" : "Confirmar importação"} subtitle={`Etapa ${stepIndex} de 3: arquivo, revisão e importação.`} presentation="center" size="lg" onClose={() => { if (!vm.importing) onClose(); }} footer={<>
    <Button variant="outline" disabled={vm.importing} onClick={vm.step === "upload" ? onClose : vm.goBack}>{vm.step === "upload" ? "Cancelar" : "Voltar"}</Button>
    {vm.step === "preview" && <Button variant="primary" disabled={!valid} onClick={vm.goToConfirm}>Continuar para confirmação</Button>}
    {vm.step === "confirm" && <Button variant="primary" loading={vm.importing} disabled={vm.importing || !valid} onClick={() => void vm.handleImportConfirm(onImport, onClose)}>{vm.importing ? "Importando…" : `Importar ${vm.parsedRows.length} produtos`}</Button>}
  </>}>
    <div className="import-dialog">
      {vm.step === "upload" && <>
        <p>Baixe o modelo e preencha uma linha por produto. As colunas <strong>name</strong> (nome), <strong>sku</strong> (código) e <strong>price</strong> (preço) são obrigatórias. Use ponto para os centavos, por exemplo, 99.90.</p>
        <CsvFileDropzone onFileSelect={vm.handleFileSelect} />
        <CsvErrorList errors={vm.errors} maxToShow={5} />
        <Button variant="outline" onClick={downloadTemplate}><Download size={16} /> Baixar modelo CSV</Button>
      </>}
      {vm.step === "preview" && <>
        <p>{vm.parsedRows.length} linhas lidas. Confira nomes, códigos, preços e estoque antes de continuar.</p>
        <CsvErrorList errors={vm.errors} maxToShow={10} />
        {vm.errors.length > 0 && <p role="alert">Corrija as linhas indicadas no arquivo e volte para enviá-lo novamente.</p>}
        <CsvPreviewTable rows={vm.parsedRows} errors={vm.errors} />
      </>}
      {vm.step === "confirm" && <>
        <p>Ao confirmar, os {vm.parsedRows.length} produtos serão enviados para o catálogo. Mantenha esta janela aberta até receber o resultado.</p>
        {vm.importError && <div className="import-dialog__error" role="alert"><strong>Não foi possível concluir a importação.</strong><p>{vm.importError}</p><p>Confira o catálogo antes de tentar novamente para evitar repetir produtos já importados.</p></div>}
        <CsvProgressBar isImporting={vm.importing} rowCount={vm.parsedRows.length} />
      </>}
    </div>
  </Modal>;
}
export type { CsvRow } from "./utils/csv-validation.js";
