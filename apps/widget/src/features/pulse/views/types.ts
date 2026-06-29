import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { CheckoutViewModel } from '../viewmodels/CheckoutViewModel';

export type RenderState = ReturnType<CheckoutViewModel['getRenderState']>;

export interface IntroCap {
  label: string;
  tint: string;
  icon: ReactElement;
}

export interface SearchResultItem {
  title: string;
  subtitle: string;
  priceStr: string;
  onAdd: () => void;
}

export interface ActionItem {
  label: string;
  fn: () => void;
  style: CSSProperties;
}

export interface ShippingOptionItem {
  label: string;
  sub: string;
  tag: string;
  price: string;
  onSelect: () => void;
  cardStyle: CSSProperties;
  tagStyle: CSSProperties;
}

export interface SummaryRow {
  label: string;
  value: string;
  rowStyle: CSSProperties;
  valStyle: CSSProperties;
}

export interface PayMethodItem {
  title: string;
  sub: string;
  badge: string;
  onSelect: () => void;
  cardStyle: CSSProperties;
  iconWrap: CSSProperties;
  icon: ReactElement;
  badgeStyle: CSSProperties;
}

export interface InstallmentItem {
  label: string;
  onSelect: () => void;
  style: CSSProperties;
}

export interface SettlementStep {
  label: string;
  status: string;
  isDone: boolean;
  isActive: boolean;
  isPending: boolean;
  showStatus: boolean;
  showLine: boolean;
  lineStyle: CSSProperties;
  labelStyle: CSSProperties;
}

export interface CompleteLine {
  label: string;
  value: string;
  valStyle: CSSProperties;
}

export interface MessageRender {
  showAvatar: boolean;
  spacerAvatar: boolean;
  isCurrentAgent?: boolean;
  rowStyle: CSSProperties;
  wrapStyle: CSSProperties;
  isText: boolean;
  isProduct: boolean;
  isCoupon: boolean;
  isBundle: boolean;
  isFieldActive: boolean;
  isAddress: boolean;
  isShipping: boolean;
  isSummary: boolean;
  isPayMethods: boolean;
  isPixForm: boolean;
  isCardForm: boolean;
  isCryptoForm: boolean;
  isSettlement: boolean;
  isComplete: boolean;
  text: string;
  bubbleStyle: CSSProperties;
  fieldTag?: string;
  options?: ShippingOptionItem[];
  rows?: SummaryRow[];
  methods?: PayMethodItem[];
  showInstallments?: boolean;
  installments?: InstallmentItem[];
  statusText?: string;
  statusStyle?: CSSProperties;
  steps?: SettlementStep[];
  isCrypto?: boolean;
  subline?: string;
  cashbackUsdc?: string;
  lines?: CompleteLine[];
}

export interface CartRow {
  label: string;
  value: string;
  valStyle: CSSProperties;
}

export interface OrderItem {
  store: string;
  region: string;
  items: string;
  amount: string;
  status: string;
  initial: string;
  avatarBg: string;
  statusStyle: CSSProperties;
}

export interface SettingRow {
  icon: ReactElement;
  label: string;
  value: string;
  fn: () => void;
  style: CSSProperties;
}

export interface SettingGroup {
  title: string;
  rows: SettingRow[];
}

export interface SupportChip {
  label: string;
  fn: () => void;
}

export interface SupportMsg {
  text: string;
  rowStyle: CSSProperties;
  bubbleStyle: CSSProperties;
}

export interface PayOpt {
  label: string;
  sub: string;
  active: boolean;
  style: CSSProperties;
  fn: () => void;
}

export interface CurrencyOpt {
  label: string;
  code: string;
  active: boolean;
  style: CSSProperties;
  fn: () => void;
}

export interface LangOpt {
  label: string;
  code: string;
  active: boolean;
  style: CSSProperties;
  fn: () => void;
}

export interface NotifRow {
  label: string;
  sub: string;
  switchStyle: CSSProperties;
  knobStyle: CSSProperties;
  fn: () => void;
}

export interface Draft {
  name: string;
  email: string;
  phone: string;
  cep: string;
  number: string;
  complement: string;
}

export type RefCallback<T> = (el: T | null) => void;
export type InputHandler = (e: React.ChangeEvent<HTMLInputElement>) => void;
export type KeyHandler = (e: React.KeyboardEvent<HTMLInputElement>) => void;
export type PointerHandler = (e: React.PointerEvent<HTMLDivElement>) => void;

export interface StageProps {
  s: RenderState;
}

export function stateStr(s: RenderState, key: string): string {
  return s[key] as string;
}

export function stateBool(s: RenderState, key: string): boolean {
  return s[key] as boolean;
}

export function stateStyle(s: RenderState, key: string): CSSProperties {
  return s[key] as CSSProperties;
}

export function stateFn(s: RenderState, key: string): () => void {
  return s[key] as () => void;
}

export function stateRef<T>(s: RenderState, key: string): RefCallback<T> {
  return s[key] as RefCallback<T>;
}

export function stateNode(s: RenderState, key: string): ReactNode {
  return s[key] as ReactNode;
}
