import React from "react";
import { lookupViaCep } from "../../../api/external/via-cep.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
import type { AddressDraft } from "../useOnboardingWizard.js";

type StepAddressProps = {
  addressDraft: AddressDraft;
  setAddressDraft: React.Dispatch<React.SetStateAction<AddressDraft>>;
  fieldErrors: Record<string, string>;
};

export function StepAddress({ addressDraft, setAddressDraft, fieldErrors }: StepAddressProps) {
  return (
    <div className="onb-fields">
      <div className="onb-field">
        <label className="onb-field-label" htmlFor="onb-cep">CEP</label>
        <input
          id="onb-cep"
          type="text"
          placeholder="01311-100"
          maxLength={9}
          value={addressDraft.zip}
          onChange={(e) => {
            let v = e.target.value.replace(/\D/g, "");
            if (v.length > 5) v = v.slice(0, 5) + "-" + v.slice(5, 8);
            setAddressDraft((d: AddressDraft) => ({ ...d, zip: v }));
            const digits = v.replace(/\D/g, "");
            if (digits.length === 8) {
              void (async () => {
                try {
                  const data = await lookupViaCep(digits);
                  if (data) {
                    setAddressDraft((d: AddressDraft) => ({
                      ...d,
                      street: data.logradouro || d.street,
                      neighborhood: data.bairro || d.neighborhood,
                      city: data.localidade || d.city,
                      state: data.uf || d.state,
                    }));
                  }
                } catch (e) {
                  reportError({ source: "onboarding.StepAddress.viaCep", error: e, context: { zip: digits } });
                }
              })();
            }
          }}
        />
        <p className="onb-field-help">Digite o CEP e o endereço será preenchido automaticamente.</p>
        {fieldErrors.zip && <span className="onb-field-error">{fieldErrors.zip}</span>}
      </div>

      <div className="onb-field">
        <label className="onb-field-label" htmlFor="onb-street">Rua / Avenida</label>
        <input id="onb-street" type="text" placeholder="Av. Paulista" value={addressDraft.street} onChange={(e) => setAddressDraft((d: AddressDraft) => ({ ...d, street: e.target.value }))} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
        <div className="onb-field">
          <label className="onb-field-label" htmlFor="onb-num">Número</label>
          <input id="onb-num" type="text" placeholder="1000" value={addressDraft.number} onChange={(e) => setAddressDraft((d: AddressDraft) => ({ ...d, number: e.target.value }))} />
        </div>
        <div className="onb-field">
          <label className="onb-field-label" htmlFor="onb-comp">Complemento</label>
          <input id="onb-comp" type="text" placeholder="Sala 101" value={addressDraft.complement} onChange={(e) => setAddressDraft((d: AddressDraft) => ({ ...d, complement: e.target.value }))} />
        </div>
      </div>

      <div className="onb-field">
        <label className="onb-field-label" htmlFor="onb-neigh">Bairro</label>
        <input id="onb-neigh" type="text" placeholder="Bela Vista" value={addressDraft.neighborhood} onChange={(e) => setAddressDraft((d: AddressDraft) => ({ ...d, neighborhood: e.target.value }))} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <div className="onb-field">
          <label className="onb-field-label" htmlFor="onb-city">Cidade</label>
          <input id="onb-city" type="text" placeholder="São Paulo" value={addressDraft.city} onChange={(e) => setAddressDraft((d: AddressDraft) => ({ ...d, city: e.target.value }))} />
        </div>
        <div className="onb-field">
          <label className="onb-field-label" htmlFor="onb-state">Estado</label>
          <input id="onb-state" type="text" placeholder="SP" maxLength={2} value={addressDraft.state} onChange={(e) => setAddressDraft((d: AddressDraft) => ({ ...d, state: e.target.value.toUpperCase() }))} />
        </div>
      </div>
    </div>
  );
}
