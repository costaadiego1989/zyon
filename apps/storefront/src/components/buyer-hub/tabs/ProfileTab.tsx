"use client";

import { useCallback, useMemo, useState } from "react";
import type { BuyerProfile, BuyerAddress } from "@/lib/viewmodels/useBuyerHub";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

// ─── Props ───────────────────────────────────────────────────────────────

export interface ProfileTabProps {
  profile: BuyerProfile | null;
  addresses: BuyerAddress[];
  loading: boolean;
  onUpdateProfile: (
    data: Partial<{ display_name: string; phone: string; email: string }>,
  ) => Promise<void>;
  onAddAddress: (
    addr: Omit<BuyerAddress, "id" | "created_at" | "is_default">,
  ) => Promise<void>;
  onUpdateAddress: (id: string, addr: Partial<BuyerAddress>) => Promise<void>;
  onDeleteAddress: (id: string) => Promise<void>;
}

// Shape of a new/edited address as captured by the mini-form.
export interface AddressFormValues {
  zip: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

// ─── Formatters ────────────────────────────────────────────────────────────

function formatPhone(value: string): string {
  const numbers = value.replace(/\D/g, "").slice(0, 11);
  if (numbers.length > 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
  if (numbers.length > 2) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  return numbers;
}

function formatCEP(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length > 5) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return digits;
}

function maskCPF(cpf?: string | null): string {
  if (!cpf) return "—";
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return cpf;
  // 123.***.***-45
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
}

// ─── Inline SVG icons ────────────────────────────────────────────────────────

function IconUser() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function IconMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 5L2 7" />
    </svg>
  );
}
function IconPhone() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function IconDoc() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}
function IconHash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
    </svg>
  );
}
function IconPin() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function IconEdit() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconSpinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ animation: "aacp-spin 0.8s linear infinite" }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// ─── Shared inline styles ────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  section: { display: "flex", flexDirection: "column", gap: 16, padding: 4 },
  card: {
    background: "var(--aacp-card, var(--aacp-surface-2))",
    border: "1px solid var(--aacp-line)",
    borderRadius: 14,
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: 700, color: "var(--aacp-fg)", margin: 0 },
  fieldRow: { display: "flex", alignItems: "flex-start", gap: 12 },
  fieldIcon: { color: "var(--aacp-muted)", marginTop: 2, flexShrink: 0 },
  fieldBody: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  fieldLabel: { fontSize: 11, fontWeight: 600, color: "var(--aacp-muted)", textTransform: "uppercase", letterSpacing: "0.04em" },
  fieldValue: { fontSize: 14, color: "var(--aacp-fg)", wordBreak: "break-word" },
  ghostBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid var(--aacp-line)",
    color: "var(--aacp-fg)",
    borderRadius: 9,
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  accentBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    background: "var(--aacp-accent)",
    border: "1px solid var(--aacp-accent)",
    color: "#fff",
    borderRadius: 9,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  inputWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  inputLabel: { fontSize: 12, fontWeight: 600, color: "var(--aacp-muted)" },
  input: {
    background: "var(--aacp-surface-3, var(--aacp-surface-2))",
    border: "1px solid var(--aacp-line)",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
    color: "var(--aacp-fg)",
    outline: "none",
    width: "100%",
  },
  errorText: { fontSize: 12, color: "#ef4444", margin: 0 },
};

// ─── Editable field row (edit mode) ──────────────────────────────────────────

function EditField(props: {
  id: string;
  label: string;
  value: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  onChange: (v: string) => void;
}) {
  return (
    <label htmlFor={props.id} style={styles.inputWrap}>
      <span style={styles.inputLabel}>{props.label}</span>
      <input
        id={props.id}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={styles.input}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--aacp-accent)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--aacp-line)")}
      />
    </label>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function Skeleton() {
  const bar = (w: string | number, h = 14): React.CSSProperties => ({
    width: w,
    height: h,
    borderRadius: 6,
    background: "var(--aacp-surface-3, var(--aacp-surface-2))",
    animation: "aacp-pulse 1.4s ease-in-out infinite",
  });
  return (
    <div style={styles.section} aria-busy="true" aria-live="polite">
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        Carregando perfil…
      </span>
      <div style={styles.card}>
        <div style={bar("40%", 16)} />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={styles.fieldRow}>
            <div style={bar(16, 16)} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
              <div style={bar("30%", 10)} />
              <div style={bar("70%")} />
            </div>
          </div>
        ))}
      </div>
      <div style={styles.card}>
        <div style={bar("35%", 16)} />
        <div style={bar("100%", 60)} />
      </div>
    </div>
  );
}

// ─── Address mini-form ───────────────────────────────────────────────────────

const EMPTY_ADDRESS: AddressFormValues = {
  zip: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
};

function AddressForm(props: {
  initial?: AddressFormValues;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (values: AddressFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<AddressFormValues>(props.initial ?? EMPTY_ADDRESS);
  const [cepLoading, setCepLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback((patch: Partial<AddressFormValues>) => {
    setValues((v) => ({ ...v, ...patch }));
  }, []);

  const fetchCep = useCallback(async (cepValue: string) => {
    const digits = cepValue.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepLoading(true);
    setError(null);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (data?.erro) {
        setError("CEP não encontrado.");
        return;
      }
      set({
        street: data.logradouro || "",
        neighborhood: data.bairro || "",
        city: data.localidade || "",
        state: data.uf || "",
      });
    } catch {
      setError("Erro ao buscar CEP.");
    } finally {
      setCepLoading(false);
    }
  }, [set]);

  const canSubmit =
    values.zip.replace(/\D/g, "").length === 8 &&
    values.street.trim() &&
    values.number.trim() &&
    values.city.trim() &&
    values.state.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      await props.onSubmit(values);
    } catch (err: any) {
      setError(err?.message || "Erro ao salvar endereço.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ ...styles.card, background: "var(--aacp-surface-2)", gap: 12 }}
      aria-label="Formulário de endereço"
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label htmlFor="addr-zip" style={styles.inputWrap}>
          <span style={styles.inputLabel}>CEP</span>
          <div style={{ position: "relative" }}>
            <input
              id="addr-zip"
              inputMode="numeric"
              value={values.zip}
              placeholder="00000-000"
              onChange={(e) => {
                const f = formatCEP(e.target.value);
                set({ zip: f });
                if (f.replace(/\D/g, "").length === 8) void fetchCep(f);
              }}
              style={styles.input}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--aacp-accent)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--aacp-line)")}
              aria-label="CEP"
            />
            {cepLoading && (
              <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--aacp-muted)" }}>
                <IconSpinner />
              </span>
            )}
          </div>
        </label>
        <EditField id="addr-number" label="Número" value={values.number} inputMode="numeric" onChange={(v) => set({ number: v })} />
      </div>

      <EditField id="addr-street" label="Rua" value={values.street} onChange={(v) => set({ street: v })} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <EditField id="addr-complement" label="Complemento" value={values.complement} onChange={(v) => set({ complement: v })} />
        <EditField id="addr-neighborhood" label="Bairro" value={values.neighborhood} onChange={(v) => set({ neighborhood: v })} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <EditField id="addr-city" label="Cidade" value={values.city} onChange={(v) => set({ city: v })} />
        <EditField id="addr-state" label="UF" value={values.state} onChange={(v) => set({ state: v.toUpperCase().slice(0, 2) })} />
      </div>

      {error && <p style={styles.errorText} role="alert">{error}</p>}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button type="button" onClick={props.onCancel} style={styles.ghostBtn} disabled={saving}>
          Cancelar
        </button>
        <button
          type="submit"
          style={{ ...styles.accentBtn, opacity: canSubmit && !saving ? 1 : 0.55, cursor: canSubmit && !saving ? "pointer" : "not-allowed" }}
          disabled={!canSubmit || saving}
        >
          {saving ? <IconSpinner /> : <IconCheck />}
          {props.submitLabel}
        </button>
      </div>
    </form>
  );
}

// ─── Address card ────────────────────────────────────────────────────────────

function AddressCard(props: {
  address: BuyerAddress;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { address } = props;
  const [deleting, setDeleting] = useState(false);
  const line1 = [address.street, address.number].filter(Boolean).join(", ");
  const line2 = [address.complement].filter(Boolean).join("");
  const line3 = [address.neighborhood, `${address.city} - ${address.state}`].filter(Boolean).join(" · ");

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await props.onDelete();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      style={{
        ...styles.card,
        background: "var(--aacp-surface-2)",
        gap: 10,
        borderColor: address.is_default ? "var(--aacp-accent)" : "var(--aacp-line)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
          <span style={{ color: "var(--aacp-accent)", marginTop: 2 }}>
            <IconPin />
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--aacp-fg)" }}>{line1 || "Endereço"}</span>
            {line2 && <span style={{ fontSize: 13, color: "var(--aacp-muted)" }}>{line2}</span>}
            {line3 && <span style={{ fontSize: 13, color: "var(--aacp-muted)" }}>{line3}</span>}
            <span style={{ fontSize: 12, color: "var(--aacp-muted)" }}>CEP {formatCEP(address.zip)}</span>
            {address.is_default && (
              <span
                style={{
                  marginTop: 4,
                  alignSelf: "flex-start",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--aacp-success, #16a34a)",
                  border: "1px solid var(--aacp-success, #16a34a)",
                  borderRadius: 20,
                  padding: "2px 8px",
                }}
              >
                Padrão
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={props.onEdit} style={{ ...styles.ghostBtn, padding: "5px 10px", fontSize: 12 }} aria-label="Editar endereço">
          <IconEdit /> Editar
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          style={{ ...styles.ghostBtn, padding: "5px 10px", fontSize: 12, color: "#ef4444", borderColor: "var(--aacp-line)" }}
          aria-label="Excluir endereço"
        >
          {deleting ? <IconSpinner /> : <IconTrash />} Excluir
        </button>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function ProfileTab({
  profile,
  addresses,
  loading,
  onUpdateProfile,
  onAddAddress,
  onUpdateAddress,
  onDeleteAddress,
}: ProfileTabProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [addingAddress, setAddingAddress] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);

  const startEdit = useCallback(() => {
    setName(profile?.display_name ?? "");
    setPhone(profile?.phone ? formatPhone(profile.phone) : "");
    setEmail(profile?.email ?? "");
    setFormError(null);
    setEditing(true);
  }, [profile]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setFormError(null);
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      await onUpdateProfile({
        display_name: name.trim(),
        phone: phone.replace(/\D/g, ""),
        email: email.trim(),
      });
      setEditing(false);
    } catch (err: any) {
      setFormError(err?.message || "Erro ao salvar perfil.");
    } finally {
      setSaving(false);
    }
  }

  const editingAddress = useMemo(
    () => addresses.find((a) => a.id === editingAddressId) ?? null,
    [addresses, editingAddressId],
  );

  const toFormValues = (a: BuyerAddress): AddressFormValues => ({
    zip: formatCEP(a.zip),
    street: a.street ?? "",
    number: a.number ?? "",
    complement: a.complement ?? "",
    neighborhood: a.neighborhood ?? "",
    city: a.city ?? "",
    state: a.state ?? "",
  });

  async function handleAddAddress(values: AddressFormValues) {
    await onAddAddress({
      zip: values.zip.replace(/\D/g, ""),
      street: values.street.trim(),
      number: values.number.trim(),
      complement: values.complement.trim() || null,
      neighborhood: values.neighborhood.trim(),
      city: values.city.trim(),
      state: values.state.trim().toUpperCase(),
    });
    setAddingAddress(false);
  }

  async function handleEditAddress(id: string, values: AddressFormValues) {
    await onUpdateAddress(id, {
      zip: values.zip.replace(/\D/g, ""),
      street: values.street.trim(),
      number: values.number.trim(),
      complement: values.complement.trim() || null,
      neighborhood: values.neighborhood.trim(),
      city: values.city.trim(),
      state: values.state.trim().toUpperCase(),
    });
    setEditingAddressId(null);
  }

  if (!profile && loading) {
    return (
      <>
        <StyleTag />
        <Skeleton />
      </>
    );
  }

  if (!profile) {
    return (
      <div style={{ ...styles.section, alignItems: "center", padding: "40px 16px", textAlign: "center" }}>
        <span style={{ color: "var(--aacp-muted)" }}>
          <IconUser />
        </span>
        <p style={{ color: "var(--aacp-muted)", fontSize: 14, margin: 0 }}>
          Não foi possível carregar seu perfil.
        </p>
      </div>
    );
  }

  return (
    <div style={styles.section}>
      <StyleTag />

      {/* ── Profile card ── */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Meu perfil</h3>
          {!editing && (
            <button type="button" onClick={startEdit} style={styles.ghostBtn} aria-label="Editar perfil">
              <IconEdit /> Editar
            </button>
          )}
        </div>

        {editing ? (
          <form onSubmit={handleSaveProfile} style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-label="Editar dados do perfil">
            <EditField id="pf-name" label="Nome" value={name} onChange={setName} />
            <EditField
              id="pf-phone"
              label="Telefone"
              value={phone}
              inputMode="tel"
              onChange={(v) => setPhone(formatPhone(v))}
            />
            <EditField id="pf-email" label="E-mail" value={email} type="email" inputMode="email" onChange={setEmail} />

            {formError && <p style={styles.errorText} role="alert">{formError}</p>}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={cancelEdit} style={styles.ghostBtn} disabled={saving}>
                Cancelar
              </button>
              <button
                type="submit"
                style={{ ...styles.accentBtn, opacity: saving ? 0.6 : 1, cursor: saving ? "not-allowed" : "pointer" }}
                disabled={saving}
              >
                {saving ? <IconSpinner /> : <IconCheck />}
                Salvar
              </button>
            </div>
          </form>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ReadField icon={<IconUser />} label="Nome" value={profile.display_name || "—"} />
            <ReadField icon={<IconMail />} label="E-mail" value={profile.email || "—"} />
            <ReadField icon={<IconPhone />} label="Telefone" value={profile.phone ? formatPhone(profile.phone) : "—"} />
            <ReadField icon={<IconDoc />} label="CPF" value={maskCPF(profile.cpf)} />
            <ReadField icon={<IconHash />} label="ID" value={profile.global_user_id} mono />
          </div>
        )}
      </div>

      {/* ── Addresses ── */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Endereços</h3>
          {!addingAddress && (
            <button
              type="button"
              onClick={() => {
                setEditingAddressId(null);
                setAddingAddress(true);
              }}
              style={styles.ghostBtn}
              aria-label="Adicionar endereço"
            >
              <IconPlus /> Adicionar endereço
            </button>
          )}
        </div>

        {addingAddress && (
          <AddressForm
            submitLabel="Adicionar"
            onCancel={() => setAddingAddress(false)}
            onSubmit={handleAddAddress}
          />
        )}

        {addresses.length === 0 && !addingAddress ? (
          <p style={{ color: "var(--aacp-muted)", fontSize: 13, margin: 0 }}>
            Nenhum endereço cadastrado.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {addresses.map((addr) =>
              editingAddressId === addr.id && editingAddress ? (
                <AddressForm
                  key={addr.id}
                  initial={toFormValues(editingAddress)}
                  submitLabel="Salvar"
                  onCancel={() => setEditingAddressId(null)}
                  onSubmit={(values) => handleEditAddress(addr.id, values)}
                />
              ) : (
                <AddressCard
                  key={addr.id}
                  address={addr}
                  onEdit={() => {
                    setAddingAddress(false);
                    setEditingAddressId(addr.id);
                  }}
                  onDelete={() => onDeleteAddress(addr.id)}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Read-only field row ─────────────────────────────────────────────────────

function ReadField(props: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div style={styles.fieldRow}>
      <span style={styles.fieldIcon}>{props.icon}</span>
      <div style={styles.fieldBody}>
        <span style={styles.fieldLabel}>{props.label}</span>
        <span style={{ ...styles.fieldValue, fontFamily: props.mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined, fontSize: props.mono ? 12 : 14 }}>
          {props.value}
        </span>
      </div>
    </div>
  );
}

// ─── Keyframes ───────────────────────────────────────────────────────────────

function StyleTag() {
  return (
    <style>{`
      @keyframes aacp-spin { to { transform: rotate(360deg); } }
      @keyframes aacp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
    `}</style>
  );
}
