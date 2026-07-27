import React from 'react';
import { resolveTenantDiscount } from '../config/tenantDiscount';
import type { AgentOrbPlacement } from '../config/agentOrbPresets';
import { PulseAPI } from '../model/PulseAPI';
import type {
  Bundle,
  Cart,
  ChatMessage,
  CheckoutProps,
  Customer,
  Order,
  PayMethod,
  Prefs,
  Product,
  ShippingOption,
  ThemeTokens,
} from '../model/types';
import { ViewModelBase } from './ViewModelBase';

export interface DomRefs {
  chat: HTMLDivElement | null;
  cam: HTMLVideoElement | null;
  wave: HTMLDivElement | null;
  support: HTMLDivElement | null;
}

interface FieldDef {
  key: keyof Customer;
  tag: string;
  ph: string;
  def: string;
}

interface ActionItem {
  label: string;
  fn: () => void;
  primary?: boolean;
}

type ModalKey = 'profile' | 'address' | 'payment' | 'locale' | 'notif' | 'security';

interface CheckoutState {
  view: 'login' | 'intro' | 'chat' | 'hub';
  chatMode: 'idle' | 'loading' | 'empty' | 'flow';
  theme: 'dark' | 'light' | null;
  open: boolean;
  drag: number | null;
  log: ChatMessage[];
  actions: ActionItem[];
  typing: boolean;
  settlementStep: number;
  askingField: keyof Customer | null;
  completed: boolean;
  orderId: string | null;
  installment: number;
  hubTab: 'orders' | 'settings';
  customer: Customer;
  prefs: Prefs;
  activeModal: ModalKey | null;
  draft: Partial<Customer>;
  cart: Cart;
  recommendation: Bundle | null;
  shipOptions: ShippingOption[];
  searchQuery: string;
  searchResults: Product[];
  searching: boolean;
  orders: Order[];
  faceStatus: 'idle' | 'scanning' | 'matching' | 'success';
  faceProgress: number;
  faceHint: string;
  camActive: boolean;
  authed: boolean;
  voiceOpen: boolean;
  voiceStatus: 'idle' | 'listening' | 'processing';
  voiceTranscript: string;
  dictating: boolean;
  shopMode: 'chat' | 'voice';
  dictatingField: boolean;
  supportOpen: boolean;
  supportLog: { role: 'user' | 'agent'; text: string }[];
  supportTyping: boolean;
  supportInput: string;
  couponShownAt: number | null;
  urgencyTick: number;
  phoneStep: 'idle' | 'enter_phone' | 'enter_code' | 'verifying' | 'done';
  phoneNumber: string;
  phoneCode: string;
  phoneError: string | null;
  pixIntentId: string | null;
  pixQrCode: string | null;
  pixCopyPaste: string | null;
  pixExpiresAt: string | null;
  pixStatus: 'idle' | 'waiting' | 'paid' | 'failed';
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitAudioContext?: typeof AudioContext;
  AudioContext?: typeof AudioContext;
}

function freshCart(): Cart {
  return { product: null, qty: 1, bundle: null, coupon: null, shipping: null, payMethod: null };
}

function freshCustomer(): Customer {
  return { name: '', email: '', cpf: '', cep: '', number: '', complement: '', phone: '' };
}

function initialState(): CheckoutState {
  return {
    view: 'login',
    chatMode: 'idle',
    theme: null,
    open: false,
    drag: null,
    log: [],
    actions: [],
    typing: false,
    settlementStep: -1,
    askingField: null,
    completed: false,
    orderId: null,
    installment: 1,
    hubTab: 'orders',
    customer: { name: '', email: '', cpf: '', cep: '', number: '', complement: '', phone: '' },
    prefs: {
      currency: 'BRL',
      lang: 'pt-BR',
      notifPromo: true,
      notifStatus: true,
      notifPush: false,
      twoFA: true,
      faceUnlock: true,
      defaultPay: 'pix',
    },
    activeModal: null,
    draft: {},
    cart: freshCart(),
    recommendation: null,
    shipOptions: [],
    searchQuery: '',
    searchResults: [],
    searching: false,
    orders: [],
    faceStatus: 'idle',
    faceProgress: 0,
    faceHint: 'Toque para iniciar o reconhecimento',
    camActive: false,
    authed: false,
    voiceOpen: false,
    voiceStatus: 'idle',
    voiceTranscript: '',
    dictating: false,
    shopMode: 'chat',
    dictatingField: false,
    supportOpen: false,
    supportLog: [],
    supportTyping: false,
    supportInput: '',
    couponShownAt: null,
    urgencyTick: 0,
    phoneStep: 'idle',
    phoneNumber: '',
    phoneCode: '',
    phoneError: null,
    pixIntentId: null,
    pixQrCode: null,
    pixCopyPaste: null,
    pixExpiresAt: null,
    pixStatus: 'idle',
  };
}

export class CheckoutViewModel extends ViewModelBase<CheckoutState> {
  SET_STEPS = [
    { label: 'Pagamento recebido', status: 'Confirmando transação…' },
    { label: 'Conversão para USDC', status: 'Convertendo…' },
    { label: 'Liquidação na Stellar', status: 'Liquidando on-chain…' },
    { label: 'Repasse ao lojista', status: 'Repassando ao lojista…' },
    { label: 'Cashback creditado', status: 'Creditando cashback…' },
    { label: 'Pedido concluído', status: 'Finalizando pedido…' },
  ];

  FIELDS: FieldDef[] = [
    { key: 'name', tag: 'Seus dados · nome', ph: 'Nome completo', def: '' },
    { key: 'email', tag: 'Seus dados · e-mail', ph: 'voce@email.com', def: '' },
    { key: 'cpf', tag: 'Seus dados · CPF', ph: '000.000.000-00', def: '' },
    { key: 'cep', tag: 'Entrega · CEP', ph: '00000-000', def: '' },
    { key: 'number', tag: 'Entrega · número', ph: 'Nº', def: '' },
    { key: 'complement', tag: 'Entrega · complemento', ph: 'Apto, bloco… (opcional)', def: '' },
  ];

  FIELD_Q: Record<keyof Customer, string> = {
    name: 'Perfeito. Para entregar seu pedido, preciso de alguns dados rápidos — como podemos te chamar?',
    email: 'Show. Qual seu melhor e-mail para o acompanhamento do pedido?',
    cpf: 'Anotado. Preciso do seu CPF para emitir a nota fiscal.',
    cep: 'Agora a entrega. Me passa o CEP de destino?',
    number: 'E o número do endereço?',
    complement: 'Tem algum complemento? (pode pular se não tiver)',
    phone: '',
  };

  PROFILE_DEFAULTS = {
    name: '',
    email: '',
    phone: '',
    cep: '',
    number: '',
    complement: '',
  };

  refs: DomRefs;
  sheetH = 470;
  peek = 74;
  timers: ReturnType<typeof setTimeout>[] = [];
  api: PulseAPI | null = null;

  private faceTimer: ReturnType<typeof setInterval> | null = null;
  private faceStream: MediaStream | null = null;
  private waveRAF: number | null = null;
  private actx: AudioContext | null = null;
  private rec: SpeechRecognitionInstance | null = null;
  private voiceStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private drec: SpeechRecognitionInstance | null = null;
  private frec: SpeechRecognitionInstance | null = null;
  private fellBack = false;
  private dragging = false;
  private startY = 0;
  private startOpen = false;
  private postFinalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private urgencyInterval: ReturnType<typeof setInterval> | null = null;
  private _pixPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(props: CheckoutProps, refs: DomRefs) {
    super(props, initialState());
    this.refs = refs;
  }

  updateProps(props: CheckoutProps): void {
    const prev = this.props;
    const prevDiscount = resolveTenantDiscount(prev);
    const nextDiscount = resolveTenantDiscount(props);
    if (
      prev.storeName === props.storeName &&
      prev.agentName === props.agentName &&
      prev.theme === props.theme &&
      prev.faceLogin === props.faceLogin &&
      prev.voiceEnabled === props.voiceEnabled &&
      prev.supportFab === props.supportFab &&
      prev.privacyUrl === props.privacyUrl &&
      prevDiscount.initialPercent === nextDiscount.initialPercent &&
      prevDiscount.bonusPercent === nextDiscount.bonusPercent &&
      prevDiscount.urgencyMinutes === nextDiscount.urgencyMinutes &&
      prevDiscount.code === nextDiscount.code
    ) {
      return;
    }
    this.props = props;
    this.api = null;
    this.notify();
  }

  private tenantDiscount() {
    return resolveTenantDiscount(this.props);
  }

  mount(): void {
    void this.ensureApi()
      .then((api) => api.getOrders())
      .then((orders) => this.setState({ orders }));
    void this.ensureApi()
      .then((api) => api.ensureSession())
      .catch(() => { /* fire-and-forget */ });
  }

  unmount(): void {
    this.clearTimers();
    this.stopUrgencyTicker();
    if (this.postFinalizeTimer) {
      clearTimeout(this.postFinalizeTimer);
      this.postFinalizeTimer = null;
    }
    if (this._pixPollTimer) {
      clearInterval(this._pixPollTimer);
      this._pixPollTimer = null;
    }
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.end);
    this.teardownMedia();
  }

  onUpdate(): void {
    const el = this.refs.chat;
    if (el) el.scrollTop = el.scrollHeight;
    this.attachCam();
  }

  get faceLoginEnabled(): boolean {
    return this.props.faceLogin !== false;
  }

  get voiceEnabled(): boolean {
    return this.props.voiceEnabled !== false;
  }

  get supportEnabled(): boolean {
    return this.props.supportFab !== false;
  }

  get theme(): 'dark' | 'light' {
    return this.state.theme || this.props.theme || 'dark';
  }

  get agentName(): string {
    return this.props.agentName || 'Pulse';
  }

  get storeName(): string {
    return this.props.storeName || '';
  }

  teardownMedia(): void {
    try {
      if (this.faceTimer) clearInterval(this.faceTimer);
    } catch {
      /* noop */
    }
    try {
      if (this.waveRAF) cancelAnimationFrame(this.waveRAF);
    } catch {
      /* noop */
    }
    try {
      if (this.actx) void this.actx.close();
    } catch {
      /* noop */
    }
    try {
      if (this.rec) this.rec.abort();
    } catch {
      /* noop */
    }
    try {
      if (this.faceStream) this.faceStream.getTracks().forEach((t) => t.stop());
    } catch {
      /* noop */
    }
    try {
      if (this.voiceStream) this.voiceStream.getTracks().forEach((t) => t.stop());
    } catch {
      /* noop */
    }
    try {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } catch {
      /* noop */
    }
  }

  attachCam(): void {
    try {
      const v = this.refs.cam;
      if (v && this.faceStream && v.srcObject !== this.faceStream) {
        v.srcObject = this.faceStream;
      }
    } catch {
      /* noop */
    }
  }

  after(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const t = setTimeout(fn, ms);
    this.timers.push(t);
    return t;
  }

  clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  async ensureApi(): Promise<PulseAPI> {
    if (this.api) return this.api;
    this.api = new PulseAPI({
      storeName: this.storeName,
      agentName: this.agentName,
      discount: this.props.discount,
      baseUrl: this.props.apiBaseUrl,
      merchantId: this.props.merchantId,
      sessionToken: this.props.sessionToken,
      sessionId: this.props.sessionId,
      initialCart: this.props.initialCart,
      initialCustomer: this.props.initialCustomer,
      allowDemoFallbacks: this.props.allowDemoFallbacks,
    });
    return this.api;
  }

  brl(n: number): string {
    const neg = n < 0;
    const [int, dec] = Math.abs(n).toFixed(2).split('.');
    const grp = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '- ' : '') + 'R$ ' + grp + ',' + dec;
  }

  calc(c: Cart): {
    product: number;
    bundle: number;
    coupon: number;
    ship: number | null;
    total: number;
    cashback: number;
    totalStr: string;
    cashbackStr: string;
    cashbackUsdc: string;
    usdc: string;
  } {
    const product = c.product ? c.product.price * c.qty : 0;
    const bundle = c.bundle ? c.bundle.price : 0;
    const coupon = c.coupon ? c.coupon.amount : 0;
    const ship = c.shipping ? c.shipping.cost : null;
    const total = product + bundle + coupon + (ship || 0);
    const cashback = total > 0 ? total * 0.03 : 0;
    return {
      product,
      bundle,
      coupon,
      ship,
      total,
      cashback,
      totalStr: this.brl(total),
      cashbackStr: this.brl(cashback),
      cashbackUsdc: (cashback / 5.2).toFixed(2),
      usdc: (total / 5.2).toFixed(2),
    };
  }

  push(...e: ChatMessage[]): void {
    this.setState((s) => ({ log: [...s.log, ...e] }));
  }

  pickUser(text: string): void {
    this.setState((s) => ({
      log: [...s.log, { role: 'user', kind: 'text', text }],
      actions: [],
    }));
  }

  agentSay(entries: ChatMessage[], actions?: ActionItem[], delay = 720): void {
    this.setState({ typing: true });
    this.after(delay, () =>
      this.setState(
        (s) => ({ typing: false, log: [...s.log, ...entries], actions: actions || [] }),
        () => {
          if (this.state.shopMode === 'voice') {
            const spoken = (entries || [])
              .filter((e) => e.role === 'agent' && e.kind === 'text')
              .map((e) => e.text)
              .join(' ');
            if (spoken) this.speak(spoken);
          }
        },
      ),
    );
  }

  A = (label: string, fn: () => void, primary = false): ActionItem => ({ label, fn, primary });

  goHub = (): void => {
    if (this.postFinalizeTimer) {
      clearTimeout(this.postFinalizeTimer);
      this.postFinalizeTimer = null;
    }
    this.setState({ view: 'hub' });
  };

  goChat = (): void => {
    this.setState({ view: 'chat' });
  };

  setOrdersTab = (): void => {
    this.setState({ hubTab: 'orders' });
  };

  setSettingsTab = (): void => {
    this.setState({ hubTab: 'settings' });
  };

  openModal = (key: ModalKey) => (): void => {
    const c = this.state.customer;
    const P = this.PROFILE_DEFAULTS;
    const draft = {
      name: c.name || P.name,
      email: c.email || P.email,
      phone: c.phone || P.phone,
      cep: c.cep || P.cep,
      number: c.number || P.number,
      complement: c.complement || P.complement,
    };
    this.setState({ activeModal: key, draft });
  };

  closeModal = (): void => {
    this.setState({ activeModal: null });
  };

  setDraft = (field: keyof Customer) => (e: React.ChangeEvent<HTMLInputElement>): void => {
    const v = e.target.value;
    this.setState((s) => ({ draft: { ...s.draft, [field]: v } }));
  };

  saveModal = (): void => {
    const k = this.state.activeModal;
    const d = this.state.draft;
    if (k === 'profile') {
      this.setState((s) => ({
        customer: { ...s.customer, name: d.name || '', email: d.email || '', phone: d.phone || '' },
      }));
    } else if (k === 'address') {
      this.setState((s) => ({
        customer: {
          ...s.customer,
          cep: d.cep || '',
          number: d.number || '',
          complement: d.complement || '',
        },
      }));
    }
    this.closeModal();
  };

  togglePref = (key: keyof Prefs) => (): void => {
    this.setState((s) => ({ prefs: { ...s.prefs, [key]: !s.prefs[key] } }));
  };

  setPref = (key: keyof Prefs, val: string) => (): void => {
    this.setState((s) => ({ prefs: { ...s.prefs, [key]: val } }));
  };

  resumeCart = (): void => {
    this.setState({ view: 'chat' });
  };

  toggleTheme = (): void => {
    this.setState({ theme: this.theme === 'dark' ? 'light' : 'dark' });
  };

  startFace = async (): Promise<void> => {
    const s = this.state.faceStatus;
    if (s === 'scanning' || s === 'matching' || s === 'success') return;
    this.setState({ faceStatus: 'scanning', faceProgress: 6, faceHint: 'Posicione seu rosto no círculo' });
    try {
      this.faceStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      this.setState({ camActive: true }, () => this.attachCam());
      this.after(140, () => this.attachCam());
    } catch {
      this.setState({ camActive: false });
    }
    this.runFaceProgress();
  };

  runFaceProgress(): void {
    if (this.faceTimer) clearInterval(this.faceTimer);
    this.faceTimer = setInterval(() => {
      this.setState(
        (s) => {
          const p = Math.min(100, s.faceProgress + (s.faceProgress < 70 ? 7 : 5));
          let status = s.faceStatus;
          let hint = s.faceHint;
          if (p >= 35 && p < 75) {
            status = 'scanning';
            hint = 'Detectando pontos faciais…';
          } else if (p >= 75 && p < 100) {
            status = 'matching';
            hint = 'Verificando sua identidade…';
          }
          return { faceProgress: p, faceStatus: status, faceHint: hint };
        },
        () => {
          if (this.state.faceProgress >= 100) {
            if (this.faceTimer) clearInterval(this.faceTimer);
            this.faceTimer = null;
            void this.onFaceMatched();
          }
        },
      );
    }, 230);
  };

  onFaceMatched = async (): Promise<void> => {
    this.setState({ faceStatus: 'success', faceHint: 'Identidade confirmada' });
    const api = await this.ensureApi();
    let user = null;
    try {
      user = await api.authenticateFace();
    } catch {
      /* noop */
    }
    try {
      if (this.faceStream) {
        this.faceStream.getTracks().forEach((t) => t.stop());
        this.faceStream = null;
      }
    } catch {
      /* noop */
    }
    this.after(820, () =>
      this.setState((s) => ({
        view: 'intro',
        authed: true,
        customer: user ? { ...s.customer, name: user.name, email: user.email } : s.customer,
      })),
    );
  };

  skipLogin = (): void => {
    if (this.faceTimer) {
      clearInterval(this.faceTimer);
      this.faceTimer = null;
    }
    try {
      if (this.faceStream) {
        this.faceStream.getTracks().forEach((t) => t.stop());
        this.faceStream = null;
      }
    } catch {
      /* noop */
    }
    this.setState({ view: 'intro', faceStatus: 'idle', faceProgress: 0, camActive: false });
  };

  startPhoneLogin = (): void => {
    this.setState({ phoneStep: 'enter_phone', phoneError: null });
  };

  onPhoneInput = (v: string): void => {
    this.setState({ phoneNumber: v });
  };

  onPhoneCodeInput = (v: string): void => {
    this.setState({ phoneCode: v });
  };

  submitPhone = async (): Promise<void> => {
    const phone = this.state.phoneNumber.trim();
    if (!phone) return;
    this.setState({ phoneError: null });
    const api = await this.ensureApi();
    try {
      const result = await api.sendPhoneCode(phone);
      if (result.ok) {
        this.setState({ phoneStep: 'enter_code' });
      } else {
        this.setState({ phoneError: 'Não foi possível enviar o código. Tente novamente.' });
      }
    } catch {
      this.setState({ phoneError: 'Erro ao enviar o código. Verifique o número e tente novamente.' });
    }
  };

  submitCode = async (): Promise<void> => {
    const phone = this.state.phoneNumber.trim();
    const code = this.state.phoneCode.trim();
    if (!phone || !code) return;
    this.setState({ phoneStep: 'verifying', phoneError: null });
    const api = await this.ensureApi();
    try {
      const result = await api.verifyPhoneCode(phone, code);
      if (result) {
        this.setState((s) => ({
          authed: true,
          phoneStep: 'done',
          customer: { ...s.customer, name: result.name || s.customer.name, email: result.email || s.customer.email },
        }));
        const orders = await api.getOrders();
        this.setState({ orders });
      } else {
        this.setState({ phoneStep: 'enter_code', phoneError: 'Código inválido. Tente novamente.' });
      }
    } catch {
      this.setState({ phoneStep: 'enter_code', phoneError: 'Erro ao verificar o código. Tente novamente.' });
    }
  };

  private getSpeechRecognition(): (new () => SpeechRecognitionInstance) | undefined {
    const w = window as WindowWithSpeech;
    return w.SpeechRecognition || w.webkitSpeechRecognition;
  }

  dictateSearch = (): void => {
    if (this.state.dictating) {
      this.stopDictation();
      return;
    }
    const SR = this.getSpeechRecognition();
    if (!SR) {
      this.openVoiceShop();
      return;
    }
    try {
      const rec = new SR();
      this.drec = rec;
      rec.lang = 'pt-BR';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      this.setState({ dictating: true, searchQuery: '', searchResults: [] });
      rec.onresult = (e) => {
        let txt = '';
        for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        this.setState({ searchQuery: txt });
        if (e.results[e.results.length - 1].isFinal) {
          this.stopDictation();
          if (txt.trim()) this.after(180, () => this.onSearch());
        }
      };
      rec.onerror = () => {
        this.stopDictation();
      };
      rec.onend = () => {
        if (this.state.dictating) this.setState({ dictating: false });
      };
      rec.start();
      this.after(9000, () => {
        if (this.state.dictating) {
          try {
            rec.stop();
          } catch {
            /* noop */
          }
        }
      });
    } catch {
      this.openVoiceShop();
    }
  };

  stopDictation = (): void => {
    if (this.drec) {
      try {
        this.drec.stop();
      } catch {
        /* noop */
      }
      this.drec = null;
    }
    this.setState({ dictating: false });
  };

  openVoiceShop = (): void => {
    if (!this.voiceEnabled) return;
    this.fellBack = false;
    this.setState({ voiceOpen: true, voiceStatus: 'listening', voiceTranscript: '' });
    this.startMicLevels();
    this.startRecognition();
  };

  startRecognition(): void {
    const SR = this.getSpeechRecognition();
    if (!SR) {
      this.fallbackVoice();
      return;
    }
    try {
      const rec = new SR();
      this.rec = rec;
      rec.lang = 'pt-BR';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        let txt = '';
        for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        this.setState({ voiceTranscript: txt });
        if (e.results[e.results.length - 1].isFinal) this.finishVoice(txt);
      };
      rec.onerror = () => {
        this.fallbackVoice();
      };
      rec.start();
      this.after(8000, () => {
        if (this.state.voiceOpen && this.state.voiceStatus === 'listening') {
          try {
            rec.stop();
          } catch {
            /* noop */
          }
          if (!this.state.voiceTranscript) this.fallbackVoice();
        }
      });
    } catch {
      this.fallbackVoice();
    }
  }

  fallbackVoice(): void {
    if (this.fellBack) return;
    this.fellBack = true;
    this.setState({ voiceOpen: false, voiceStatus: 'idle', voiceTranscript: '' });
  }

  startMicLevels(): void {
    try {
      void navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          if (!this.state.voiceOpen) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          this.voiceStream = stream;
          const w = window as WindowWithSpeech;
          const Ctx = w.AudioContext || w.webkitAudioContext;
          if (!Ctx) return;
          const actx = new Ctx();
          this.actx = actx;
          const src = actx.createMediaStreamSource(stream);
          const an = actx.createAnalyser();
          an.fftSize = 256;
          src.connect(an);
          this.analyser = an;
          const data = new Uint8Array(an.frequencyBinCount);
          const loop = (): void => {
            if (!this.analyser) return;
            an.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const avg = sum / data.length / 255;
            const amp = (0.35 + avg * 1.7).toFixed(2);
            const el = this.refs.wave;
            if (el) el.style.setProperty('--amp', amp);
            this.waveRAF = requestAnimationFrame(loop);
          };
          loop();
        })
        .catch(() => {});
    } catch {
      /* noop */
    }
  }

  finishVoice(transcript: string): void {
    const q = (transcript || '').trim();
    if (!q) return;
    this.setState({ voiceStatus: 'processing', voiceTranscript: q });
    this.after(750, () => {
      this.stopVoice(true);
      void this.processVoice(q);
    });
  }

  stopVoice = (keepResult?: boolean): void => {
    if (this.rec) {
      try {
        this.rec.abort();
      } catch {
        /* noop */
      }
      this.rec = null;
    }
    if (this.waveRAF) {
      cancelAnimationFrame(this.waveRAF);
      this.waveRAF = null;
    }
    this.analyser = null;
    if (this.actx) {
      try {
        void this.actx.close();
      } catch {
        /* noop */
      }
      this.actx = null;
    }
    if (this.voiceStream) {
      try {
        this.voiceStream.getTracks().forEach((t) => t.stop());
      } catch {
        /* noop */
      }
      this.voiceStream = null;
    }
    this.fellBack = false;
    if (keepResult === true) this.setState({ voiceOpen: false });
    else this.setState({ voiceOpen: false, voiceStatus: 'idle', voiceTranscript: '' });
  };

  async processVoice(q: string): Promise<void> {
    this.speak('Encontrei algumas opções para ' + q + '.');
    this.setState({
      view: 'chat',
      chatMode: 'empty',
      searchQuery: q,
      searchResults: [],
      searching: true,
      open: false,
    });
    const api = await this.ensureApi();
    const res = await api.searchProducts(q);
    this.setState({ searching: false, searchResults: res, chatMode: 'empty' });
  }

  speak(text: string): void {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* noop */
    }
  }

  openSupport = (): void => {
    if (this.supportEnabled) this.setState({ supportOpen: true });
  };

  closeSupport = (): void => {
    this.setState({ supportOpen: false });
  };

  onSupportInput = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({ supportInput: e.target.value });
  };

  onSupportKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') this.sendSupport();
  };

  askSupport = (text: string) => (): void => {
    void this.runSupport(text);
  };

  sendSupport = (): void => {
    const t = (this.state.supportInput || '').trim();
    if (!t) return;
    this.setState({ supportInput: '' });
    void this.runSupport(t);
  };

  async runSupport(text: string): Promise<void> {
    this.setState((s) => ({
      supportLog: [...s.supportLog, { role: 'user', text }],
      supportTyping: true,
    }));
    this.scrollSupport();
    const api = await this.ensureApi();
    let answer: string;
    try {
      const r = await api.supportAnswer(text);
      answer = (r && r.answer) || String(r);
    } catch {
      answer = 'Tive um probleminha aqui — pode repetir, por favor?';
    }
    this.after(320, () =>
      this.setState(
        (s) => ({
          supportTyping: false,
          supportLog: [...s.supportLog, { role: 'agent', text: answer }],
        }),
        () => this.scrollSupport(),
      ),
    );
  }

  scrollSupport(): void {
    this.after(40, () => {
      const el = this.refs.support;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  startVoiceChat = (): void => {
    this.setState({ shopMode: 'voice' });
    void this.startChat();
  };

  toggleVoiceMode = (): void => {
    const next = this.state.shopMode === 'voice' ? 'chat' : 'voice';
    if (next === 'chat') {
      try {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      } catch {
        /* noop */
      }
      this.stopFieldDictation();
    }
    this.setState({ shopMode: next }, () => {
      if (next === 'voice') {
        const last = [...this.state.log].reverse().find((m) => m.role === 'agent' && m.kind === 'text');
        if (last?.text) this.speak(last.text);
      }
    });
  };

  dictateField = (): void => {
    if (this.state.dictatingField) {
      this.stopFieldDictation();
      return;
    }
    const SR = this.getSpeechRecognition();
    const k = this.state.askingField;
    if (!k) return;
    if (!SR) return;
    try {
      const rec = new SR();
      this.frec = rec;
      rec.lang = 'pt-BR';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      this.setState({ dictatingField: true, shopMode: 'voice' });
      rec.onresult = (e) => {
        let txt = '';
        for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        const val = this.normalizeField(k, txt);
        this.setState((s) => ({ customer: { ...s.customer, [k]: val } }));
        if (e.results[e.results.length - 1].isFinal) {
          this.stopFieldDictation();
          if (val.trim()) this.after(280, () => this.confirmField());
        }
      };
      rec.onerror = () => {
        this.stopFieldDictation();
      };
      rec.onend = () => {
        if (this.state.dictatingField) this.setState({ dictatingField: false });
      };
      rec.start();
      this.after(9000, () => {
        if (this.state.dictatingField) {
          try {
            rec.stop();
          } catch {
            /* noop */
          }
        }
      });
    } catch {
      this.stopFieldDictation();
    }
  };

  stopFieldDictation = (): void => {
    if (this.frec) {
      try {
        this.frec.stop();
      } catch {
        /* noop */
      }
      this.frec = null;
    }
    this.setState({ dictatingField: false });
  };

  normalizeField(key: keyof Customer, txt: string): string {
    if (key === 'cpf' || key === 'cep' || key === 'number') {
      const digits = (txt || '').replace(/\D/g, '');
      return digits || txt.trim();
    }
    return (txt || '').trim();
  }

  startChat = async (): Promise<void> => {
    this.clearTimers();
    this.setState({
      view: 'chat',
      chatMode: 'loading',
      log: [],
      actions: [],
      typing: false,
      settlementStep: -1,
      askingField: null,
      completed: false,
      orderId: null,
      open: false,
      cart: freshCart(),
      customer: { name: '', email: '', cpf: '', cep: '', number: '', complement: '', phone: '' },
      searchQuery: '',
      searchResults: [],
    });
    const api = await this.ensureApi();
    const [{ product, qty }, rec] = await Promise.all([api.getCart(), api.getRecommendation()]);
    const coupon = await api.getBestCoupon(product.price, this.tenantDiscount());
    this.setState({
      chatMode: 'flow',
      cart: { product, qty, bundle: null, coupon, shipping: null, payMethod: null },
      recommendation: rec,
      couponShownAt: Date.now(),
    });
    this.startUrgencyTicker();
    this.greetBody(product);
  };

  restart = (): void => {
    this.buyAgain();
  };

  /** Esvazia carrinho, limpa sessão e abre tela de busca (voz/texto). */
  buyAgain = (): void => {
    if (this.postFinalizeTimer) {
      clearTimeout(this.postFinalizeTimer);
      this.postFinalizeTimer = null;
    }
    this.clearTimers();
    this.stopUrgencyTicker();
    this.setState({
      chatMode: 'empty',
      log: [],
      actions: [],
      typing: false,
      askingField: null,
      settlementStep: -1,
      open: false,
      completed: false,
      orderId: null,
      cart: freshCart(),
      customer: freshCustomer(),
      searchQuery: '',
      searchResults: [],
      searching: false,
      recommendation: null,
      couponShownAt: null,
      installment: 1,
    });
  };

  private scheduleEmptyShopping(delayMs = 7000): void {
    if (this.postFinalizeTimer) clearTimeout(this.postFinalizeTimer);
    this.postFinalizeTimer = setTimeout(() => {
      this.postFinalizeTimer = null;
      this.buyAgain();
      if (this.voiceEnabled && this.state.shopMode === 'voice') {
        this.speak('Me diz o que você procura que eu monto um novo carrinho pra você.');
      }
    }, delayMs);
  }

  private couponStillValid(): boolean {
    const { couponShownAt, cart } = this.state;
    if (!cart.coupon?.pendingAmount) return false;
    const mins = cart.coupon.urgencyMinutes ?? 5;
    if (!couponShownAt) return true;
    return Date.now() - couponShownAt <= mins * 60 * 1000;
  }

  private getCouponCountdown(): string {
    void this.state.urgencyTick;
    const { couponShownAt, cart } = this.state;
    const mins = cart.coupon?.urgencyMinutes ?? 5;
    if (!couponShownAt || !cart.coupon?.pendingAmount) return '';
    const left = Math.max(0, couponShownAt + mins * 60 * 1000 - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private startUrgencyTicker(): void {
    this.stopUrgencyTicker();
    if (!this.state.cart.coupon?.pendingAmount) return;
    this.urgencyInterval = setInterval(() => {
      if (!this.couponStillValid()) {
        this.stopUrgencyTicker();
      }
      this.setState({ urgencyTick: Date.now() });
    }, 1000);
  }

  private stopUrgencyTicker(): void {
    if (this.urgencyInterval) {
      clearInterval(this.urgencyInterval);
      this.urgencyInterval = null;
    }
  }

  private unlockPendingCoupon(): void {
    const c = this.state.cart.coupon;
    if (!c?.pendingAmount || !this.couponStillValid()) return;
    const pending = c.pendingAmount;
    this.setState((s) => ({
      cart: {
        ...s.cart,
        coupon: {
          ...s.cart.coupon!,
          amount: s.cart.coupon!.amount + pending,
          pendingAmount: 0,
          label: `${c.appliedPercent ?? this.tenantDiscount().initialPercent}% + ${c.pendingPercent ?? this.tenantDiscount().bonusPercent}% de desconto`,
        },
      },
    }));
    this.stopUrgencyTicker();
  }

  greetBody(product: Product): void {
    this.agentSay(
      [
        {
          role: 'agent',
          kind: 'text',
          text: `Oi! Eu sou a ${this.agentName}, gerente de vendas da ${this.storeName}. Vi que você está levando o ${product.title} — já garanti a melhor promoção e apliquei no seu carrinho.`,
        },
        { role: 'agent', kind: 'product' },
        { role: 'agent', kind: 'coupon' },
      ],
      [this.A('Continuar', this.onAfterPromo, true)],
      280,
    );
  }

  onAfterPromo = (): void => {
    const p = this.state.cart.product;
    this.pickUser('Continuar');
    this.agentSay(
      [
        {
          role: 'agent',
          kind: 'text',
          text: `Quem leva o ${p ? p.title : 'produto'} costuma adicionar isto também — consigo um desconto de combo se você quiser. Sem pressão, pode pular:`,
        },
        { role: 'agent', kind: 'bundle' },
      ],
      [this.A('Adicionar combo', this.onAddBundle, true), this.A('Pular', this.onSkipBundle)],
    );
  };

  onAddBundle = (): void => {
    this.setState((s) => ({ cart: { ...s.cart, bundle: s.recommendation } }));
    this.pickUser('Adicionar combo');
    this.askField(0);
  };

  onSkipBundle = (): void => {
    this.pickUser('Pular');
    this.askField(0);
  };

  askField(idx: number): void {
    const f = this.FIELDS[idx];
    this.setState((s) => ({
      askingField: f.key,
      customer: { ...s.customer, [f.key]: s.customer[f.key] || f.def },
    }));
    this.agentSay(
      [{ role: 'agent', kind: 'text', text: this.FIELD_Q[f.key] }, { role: 'agent', kind: 'field', field: f.key }],
      [],
      600,
    );
  }

  onFieldInput = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const k = this.state.askingField;
    if (!k) return;
    const v = e.target.value;
    this.setState((s) => ({ customer: { ...s.customer, [k]: v } }));
  };

  onFieldKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') this.confirmField();
  };

  fieldBack = (): void => {
    const k = this.state.askingField;
    if (!k) return;
    const idx = this.FIELDS.findIndex((f) => f.key === k);
    if (idx <= 0) return;
    this.stopFieldDictation();
    const prev = this.FIELDS[idx - 1];
    this.setState((s) => ({ log: s.log.slice(0, -2), askingField: prev.key }));
  };

  reviseData = (): void => {
    this.pickUser('Corrigir meus dados');
    this.after(120, () => this.askField(0));
  };

  confirmField = (): void => {
    const k = this.state.askingField;
    if (!k) return;
    const idx = this.FIELDS.findIndex((f) => f.key === k);
    this.setState({ askingField: null });
    if (idx < this.FIELDS.length - 1) {
      this.after(60, () => this.askField(idx + 1));
    } else {
      this.after(120, () => void this.onAddressDone());
    }
  };

  onAddressDone = async (): Promise<void> => {
    const api = await this.ensureApi();
    const opts = await api.getShipping(this.state.customer);
    this.setState({ shipOptions: opts });
    this.agentSay(
      [
        { role: 'agent', kind: 'text', text: 'Tudo certo com seus dados. Confirmei seu endereço:' },
        { role: 'agent', kind: 'address' },
        { role: 'agent', kind: 'text', text: 'Agora escolha como prefere receber:' },
        { role: 'agent', kind: 'shipping' },
      ],
      [],
      600,
    );
  };

  onChooseShipping = (opt: ShippingOption) => (): void => {
    this.setState((s) => ({ cart: { ...s.cart, shipping: opt } }));
    this.pickUser('Entrega · ' + opt.label);
    this.agentSay(
      [
        {
          role: 'agent',
          kind: 'text',
          text: 'Fechado. Aqui está o resumo do seu pedido com a promoção e o frete aplicados:',
        },
        { role: 'agent', kind: 'summary' },
      ],
      [
        this.A('Confirmar pedido', this.onConfirm, true),
        this.A('Corrigir dados', this.reviseData),
        this.A('Editar carrinho', this.onEditCart),
      ],
    );
  };

  onEditCart = (): void => {
    this.setState({ open: true });
  };

  onConfirm = (): void => {
    this.unlockPendingCoupon();
    this.pickUser('Confirmar pedido');
    this.agentSay(
      [{ role: 'agent', kind: 'text', text: 'Quase lá! É só escolher como você quer pagar:' }, { role: 'agent', kind: 'paymethods' }],
      [],
    );
  };

  onChooseMethod = (m: PayMethod) => (): void => {
    this.setState((s) => ({ cart: { ...s.cart, payMethod: m } }));
    const calc = this.calc(this.state.cart);
    if (m === 'pix') {
      this.pickUser('Pagar com Pix');
      this.agentSay(
        [
          { role: 'agent', kind: 'text', text: 'Pix gerado! Pague na hora e confirmo seu pedido automaticamente.' },
          { role: 'agent', kind: 'pixform' },
        ],
        [this.A('Já paguei · confirmar', this.onPay('pix'), true), this.A('Trocar método', this.onAnother)],
      );
    } else if (m === 'credito') {
      this.pickUser('Pagar com crédito');
      this.agentSay(
        [
          {
            role: 'agent',
            kind: 'text',
            text: 'Você pode parcelar sem juros. Confira os dados e escolha as parcelas:',
          },
          { role: 'agent', kind: 'cardform', installments: true },
        ],
        [this.A('Pagar ' + calc.totalStr, this.onPay('credito'), true), this.A('Trocar método', this.onAnother)],
      );
    } else if (m === 'debito') {
      this.pickUser('Pagar com débito');
      this.agentSay(
        [
          { role: 'agent', kind: 'text', text: 'Pagamento à vista no débito. É só confirmar os dados do cartão:' },
          { role: 'agent', kind: 'cardform', installments: false },
        ],
        [this.A('Pagar ' + calc.totalStr, this.onPay('debito'), true), this.A('Trocar método', this.onAnother)],
      );
    } else {
      this.pickUser('Pagar com crypto');
      this.agentSay(
        [
          {
            role: 'agent',
            kind: 'text',
            text: 'No crypto a liquidação é instantânea na Stellar e você ainda ganha cashback em USDC:',
          },
          { role: 'agent', kind: 'cryptoform' },
        ],
        [this.A('Confirmar pagamento', this.onPayCrypto, true), this.A('Trocar método', this.onAnother)],
      );
    }
  };

  onAnother = (): void => {
    this.setState((s) => ({ cart: { ...s.cart, payMethod: null } }));
    this.pickUser('Trocar método');
    this.agentSay(
      [{ role: 'agent', kind: 'text', text: 'Sem problema — aqui estão as opções de novo:' }, { role: 'agent', kind: 'paymethods' }],
      [],
    );
  };

  onPay = (method: PayMethod) => (): void => {
    const label = method === 'pix' ? 'Já paguei · confirmar' : 'Pagar ' + this.calc(this.state.cart).totalStr;
    this.pickUser(label);
    this.setState({ actions: [], typing: true });
    this.after(1500, () => {
      this.setState({ typing: false });
      void this.finalize(method);
    });
  };

  onPayCrypto = (): void => {
    this.pickUser('Confirmar pagamento');
    this.setState({ actions: [], typing: true });
    this.after(550, () => {
      this.setState((s) => ({
        typing: false,
        settlementStep: 0,
        log: [...s.log, { role: 'agent', kind: 'settlement' }],
      }));
      this.tickSettlement();
    });
  };

  tickSettlement = (): void => {
    this.after(820, () => {
      this.setState(
        (s) => ({ settlementStep: s.settlementStep + 1 }),
        () => {
          if (this.state.settlementStep >= this.SET_STEPS.length - 1) {
            this.after(680, () => void this.finalize('crypto'));
          } else {
            this.tickSettlement();
          }
        },
      );
    });
  };

  async finalize(method: PayMethod): Promise<void> {
    const api = await this.ensureApi();
    const c = this.state.cart;
    const calc = this.calc(c);
    const crypto = method === 'crypto';
    const order = await api.createOrder(method);

    if (method === 'pix' && (order.pixQrCode || order.pixCopyPaste)) {
      this.setState({
        pixIntentId: order.id,
        pixQrCode: order.pixQrCode ?? null,
        pixCopyPaste: order.pixCopyPaste ?? null,
        pixExpiresAt: order.pixExpiresAt ?? null,
        pixStatus: 'waiting',
      });
      this.startPixPolling(order.id);
      return;
    }

    if (method === 'credito' || method === 'debito') {
      const result = await api.confirmStripePayment(order.id);
      if (result.status !== 'approved') throw new Error('card_payment_not_approved');
    }

    this.completeOrder(method, order.id, crypto, c, calc);
  }

  startPixPolling(intentId: string): void {
    if (this._pixPollTimer) {
      clearInterval(this._pixPollTimer);
      this._pixPollTimer = null;
    }
    void this.ensureApi().then((api) => {
      this._pixPollTimer = setInterval(() => {
        void api.checkPaymentStatus(intentId).then((status) => {
          if (status === 'paid') {
            if (this._pixPollTimer) {
              clearInterval(this._pixPollTimer);
              this._pixPollTimer = null;
            }
            this.setState({ pixStatus: 'paid' });
            const c = this.state.cart;
            const calc = this.calc(c);
            this.completeOrder('pix', intentId, false, c, calc);
          } else if (status === 'failed') {
            if (this._pixPollTimer) {
              clearInterval(this._pixPollTimer);
              this._pixPollTimer = null;
            }
            this.setState({ pixStatus: 'failed' });
          }
        });
      }, 3000);
    });
  }

  private completeOrder(
    method: PayMethod,
    orderId: string,
    crypto: boolean,
    c: Cart,
    calc: ReturnType<typeof this.calc>,
  ): void {
    const sub = crypto
      ? 'Liquidação confirmada na Stellar. Cashback liberado.'
      : 'Seu pedido foi confirmado e o lojista já foi pago.';
    const newOrder: Order = {
      store: this.storeName,
      region: 'São Paulo · BR',
      items: c.product!.title + (c.bundle ? ' + Lâmpadas' : ''),
      amount: calc.totalStr,
      tone: 'progress',
      status: 'Processando',
      initial: this.storeName.slice(0, 1).toUpperCase(),
      bg: '#1ED760',
    };
    this.setState((s) => ({
      completed: true,
      orderId,
      orders: [newOrder, ...s.orders],
      cart: freshCart(),
      customer: freshCustomer(),
      askingField: null,
      settlementStep: -1,
      open: false,
      searchQuery: '',
      searchResults: [],
      recommendation: null,
      installment: 1,
      couponShownAt: null,
    }));
    this.stopUrgencyTicker();
    const confirmText = crypto
      ? 'Pronto! Pagamento liquidado e cashback creditado. Seu pedido está confirmado.'
      : 'Pronto! Pagamento aprovado e pedido confirmado. Já cuido do resto pra você.';
    this.push(
      { role: 'agent', kind: 'text', text: confirmText },
      { role: 'agent', kind: 'complete', method, subline: sub, orderId },
    );
    this.setState({
      actions: [this.A('Ver meus pedidos', this.goHub, true), this.A('Comprar de novo', this.buyAgain)],
    });
    if (this.state.shopMode === 'voice') {
      const deliver = c.shipping ? ' ' + c.shipping.sub + '.' : '';
      this.speak(confirmText + ' O total foi ' + calc.totalStr + '.' + deliver);
    }
    this.scheduleEmptyShopping();
  }

  removeProduct = (): void => {
    this.clearTimers();
    this.stopUrgencyTicker();
    if (this.postFinalizeTimer) {
      clearTimeout(this.postFinalizeTimer);
      this.postFinalizeTimer = null;
    }
    this.setState({
      cart: freshCart(),
      chatMode: 'empty',
      open: false,
      log: [],
      actions: [],
      typing: false,
      askingField: null,
      completed: false,
      orderId: null,
      customer: freshCustomer(),
      searchResults: [],
      searchQuery: '',
      recommendation: null,
      installment: 1,
      settlementStep: -1,
      couponShownAt: null,
    });
  };

  onSearchInput = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const v = e.target.value;
    this.setState({ searchQuery: v });
  };

  onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') void this.onSearch();
  };

  onSearch = async (): Promise<void> => {
    this.setState({ searching: true, searchResults: [] });
    const api = await this.ensureApi();
    const res = await api.searchProducts(this.state.searchQuery);
    this.setState({ searching: false, searchResults: res });
  };

  onAddSearched = (item: Product) => (): void => {
    void this.resumeWithProduct(item);
  };

  async resumeWithProduct(product: Product): Promise<void> {
    this.clearTimers();
    this.stopUrgencyTicker();
    this.setState({ chatMode: 'loading', searchResults: [], searchQuery: '' });
    const api = await this.ensureApi();
    const [coupon, rec] = await Promise.all([
      api.getBestCoupon(product.price, this.tenantDiscount()),
      api.getRecommendation(),
    ]);
    this.setState({
      chatMode: 'flow',
      log: [],
      actions: [],
      completed: false,
      askingField: null,
      customer: { name: '', email: '', cpf: '', cep: '', number: '', complement: '', phone: '' },
      cart: { product, qty: 1, bundle: null, coupon, shipping: null, payMethod: null },
      recommendation: rec,
      couponShownAt: Date.now(),
    });
    this.startUrgencyTicker();
    this.greetBody(product);
  }

  inc = (): void => {
    this.setState((s) => ({ cart: { ...s.cart, qty: Math.min(9, s.cart.qty + 1) } }));
  };

  dec = (): void => {
    this.setState((s) => ({ cart: { ...s.cart, qty: Math.max(1, s.cart.qty - 1) } }));
  };

  setInstallment = (n: number) => (): void => {
    this.setState({ installment: n });
  };

  closeCart = (): void => {
    this.setState({ open: false, drag: null });
  };

  startDrag = (e: React.PointerEvent): void => {
    this.startY = e.clientY;
    this.startOpen = this.state.open;
    this.dragging = true;
    this.setState({ drag: 0 });
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.end);
    e.preventDefault();
  };

  move = (e: PointerEvent): void => {
    if (this.dragging) this.setState({ drag: e.clientY - this.startY });
  };

  end = (): void => {
    this.dragging = false;
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.end);
    const dy = this.state.drag || 0;
    let open = this.startOpen;
    if (Math.abs(dy) < 6) open = !this.startOpen;
    else if (this.startOpen && dy > 70) open = false;
    else if (!this.startOpen && dy < -70) open = true;
    this.setState({ open, drag: null });
  };

  tokens(): ThemeTokens {
    const T: Record<'dark' | 'light', ThemeTokens> = {
      dark: {
        bg: '#08080c',
        tx: '#f5f5f7',
        mut: '#8b8b95',
        card: 'rgba(255,255,255,0.05)',
        bd: 'rgba(255,255,255,0.1)',
        chip: 'rgba(255,255,255,0.05)',
        sheet: '#0f0f16',
        sheetbd: 'rgba(255,255,255,0.13)',
        dot: '#1ED760',
        g1: '#1ED760',
        g2: '#1ED760',
        g3: '#1ED760',
        tile1: 'rgba(255,255,255,.09)',
        tile2: 'rgba(255,255,255,.025)',
        scrim: '0,0,0',
        userTx: '#fff',
        shadow: '0 34px 70px -28px rgba(0,0,0,.75)',
      },
      light: {
        bg: '#ffffff',
        tx: '#141418',
        mut: '#71717a',
        card: '#f7f6f3',
        bd: 'rgba(15,15,25,0.09)',
        chip: '#f2f1ed',
        sheet: '#ffffff',
        sheetbd: 'rgba(15,15,25,0.1)',
        dot: '#1ED760',
        g1: '#1ED760',
        g2: '#1ED760',
        g3: '#1ED760',
        tile1: 'rgba(15,15,25,.07)',
        tile2: 'rgba(15,15,25,.02)',
        scrim: '26,18,48',
        userTx: '#fff',
        shadow: '0 34px 70px -30px rgba(40,30,80,.28)',
      },
    };
    return T[this.theme];
  }

  buildMsg(m: ChatMessage, t: ThemeTokens): Record<string, unknown> {
    const c = this.state.cart;
    const calc = this.calc(c);
    const fieldConfirmed = m.kind === 'field' && m.field !== this.state.askingField;
    const isUser = m.role === 'user' || fieldConfirmed;
    const base: Record<string, unknown> = {
      role: m.role,
      isUser,
      text: m.text || '',
      showAvatar: m.role === 'agent' && !fieldConfirmed,
      spacerAvatar: false,
      rowStyle: {
        display: 'flex',
        gap: '9px',
        alignItems: 'flex-end',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginTop: '14px',
        animation: 'msgIn .35s ease both',
      } as React.CSSProperties,
      wrapStyle: {
        maxWidth: isUser ? '76%' : '82%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '9px',
      } as React.CSSProperties,
      isText: m.kind === 'text',
      isProduct: m.kind === 'product',
      isCoupon: m.kind === 'coupon',
      isBundle: m.kind === 'bundle',
      isAddress: m.kind === 'address',
      isShipping: m.kind === 'shipping',
      isSummary: m.kind === 'summary',
      isPayMethods: m.kind === 'paymethods',
      isPixForm: m.kind === 'pixform',
      isCardForm: m.kind === 'cardform',
      isCryptoForm: m.kind === 'cryptoform',
      isSettlement: m.kind === 'settlement',
      isComplete: m.kind === 'complete',
      isFieldActive: m.kind === 'field' && !fieldConfirmed,
      bubbleStyle: isUser
        ? ({
            background: t.g1,
            color: t.userTx,
            fontSize: '13.5px',
            lineHeight: 1.5,
            padding: '11px 14px',
            borderRadius: '16px 16px 4px 16px',
            fontWeight: 500,
          } as React.CSSProperties)
        : ({
            background: t.card,
            color: t.tx,
            fontSize: '13.5px',
            lineHeight: 1.55,
            padding: '12px 14px',
            borderRadius: '16px 16px 16px 4px',
            border: '1px solid ' + t.bd,
          } as React.CSSProperties),
    };

    if (m.kind === 'field' && m.field) {
      const f = this.FIELDS.find((x) => x.key === m.field);
      if (f) {
        base.fieldTag = f.tag;
        base.fieldPlaceholder = f.ph;
        if (fieldConfirmed) {
          const v = this.state.customer[m.field as keyof Customer];
          base.isText = true;
          base.text = v && v.length ? v : '(sem complemento)';
        }
      }
    }

    if (m.kind === 'shipping') {
      base.options = this.state.shipOptions.map((o) => {
        const sel = c.shipping && c.shipping.key === o.key;
        return {
          label: o.label,
          sub: o.sub,
          tag: o.tag,
          price: o.cost ? this.brl(o.cost) : 'Grátis',
          onSelect: this.onChooseShipping(o),
          cardStyle: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '13px',
            borderRadius: '15px',
            cursor: 'pointer',
            background: t.card,
            border: '1.5px solid ' + (sel ? t.g1 : t.bd),
          } as React.CSSProperties,
          tagStyle: {
            fontFamily: "'Space Mono',monospace",
            fontSize: '8px',
            letterSpacing: '.5px',
            textTransform: 'uppercase',
            color: t.g2,
            border: '1px solid ' + t.sheetbd,
            borderRadius: '20px',
            padding: '2px 6px',
            whiteSpace: 'nowrap',
          } as React.CSSProperties,
        };
      });
    }

    if (m.kind === 'summary') {
      const rowS: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
      };
      const valS: React.CSSProperties = { fontSize: '13px', fontWeight: 600, flex: 'none', whiteSpace: 'nowrap' };
      const rows: { label: string; value: string; rowStyle: React.CSSProperties; valStyle: React.CSSProperties }[] = [];
      if (c.product)
        rows.push({
          label: c.product.title + ' ×' + c.qty,
          value: this.brl(c.product.price * c.qty),
          rowStyle: rowS,
          valStyle: valS,
        });
      if (c.bundle)
        rows.push({
          label: 'Combo · ' + c.bundle.title,
          value: this.brl(c.bundle.price),
          rowStyle: { ...rowS, borderTop: '1px solid ' + t.bd },
          valStyle: valS,
        });
      if (c.coupon)
        rows.push({
          label: 'Promoção · ' + c.coupon.code,
          value: this.brl(c.coupon.amount),
          rowStyle: { ...rowS, borderTop: '1px solid ' + t.bd },
          valStyle: { ...valS, color: '#1ED760' },
        });
      rows.push({
        label: 'Frete · ' + (c.shipping ? c.shipping.label : '—'),
        value: calc.ship ? this.brl(calc.ship) : 'Grátis',
        rowStyle: { ...rowS, borderTop: '1px solid ' + t.bd },
        valStyle: valS,
      });
      base.rows = rows;
    }

    if (m.kind === 'paymethods') {
      const mk = (
        key: PayMethod,
        title: string,
        sub: string,
        badge: string,
        iconType: 'pix' | 'card' | 'crypto',
      ) => {
        const sel = c.payMethod === key;
        return {
          title,
          sub,
          badge,
          onSelect: this.onChooseMethod(key),
          cardStyle: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px',
            borderRadius: '15px',
            cursor: 'pointer',
            background: t.card,
            border: '1.5px solid ' + (sel ? t.g1 : t.bd),
          } as React.CSSProperties,
          iconWrap: {
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background:
              iconType === 'crypto'
                ? t.g1
                : iconType === 'pix'
                  ? 'rgba(30,215,96,.16)'
                  : 'rgba(45,212,255,.14)',
          } as React.CSSProperties,
          icon: this.payIcon(iconType, t),
          badgeStyle: badge
            ? ({
                fontFamily: "'Space Mono',monospace",
                fontSize: '8px',
                letterSpacing: '.5px',
                textTransform: 'uppercase',
                color: t.g2,
                border: '1px solid ' + t.sheetbd,
                borderRadius: '20px',
                padding: '2px 6px',
                whiteSpace: 'nowrap',
              } as React.CSSProperties)
            : ({ display: 'none' } as React.CSSProperties),
        };
      };
      base.methods = [
        mk('pix', 'Pix', 'Pagamento instantâneo, sem taxas', 'Na hora', 'pix'),
        mk('credito', 'Cartão de crédito', 'Parcele em até 12x sem juros', '12x', 'card'),
        mk('debito', 'Cartão de débito', 'Débito à vista', '', 'card'),
        mk('crypto', 'Crypto · USDC', 'Liquida na Stellar + cashback', 'Cashback', 'crypto'),
      ];
    }

    if (m.kind === 'cardform') {
      base.showInstallments = !!m.installments;
      if (m.installments) {
        base.installments = [1, 3, 6, 12].map((n) => {
          const sel = this.state.installment === n;
          const val = calc.total / n;
          return {
            label: n + 'x ' + this.brl(val),
            onSelect: this.setInstallment(n),
            style: {
              cursor: 'pointer',
              border: '1px solid ' + (sel ? t.g1 : t.bd),
              background: sel ? t.g1 : t.chip,
              color: sel ? '#fff' : t.tx,
              fontFamily: 'inherit',
              fontSize: '11px',
              fontWeight: 600,
              padding: '8px 11px',
              borderRadius: '10px',
            } as React.CSSProperties,
          };
        });
      }
    }

    if (m.kind === 'settlement') {
      const cur = this.state.settlementStep;
      base.statusText = cur >= this.SET_STEPS.length - 1 ? 'Confirmado na Stellar' : 'Liquidando…';
      base.statusStyle = { fontFamily: "'Space Mono',monospace", fontSize: '9px', color: t.g2 } as React.CSSProperties;
      base.steps = this.SET_STEPS.map((s, i) => {
        const done = i < cur;
        const active = i === cur;
        const pending = i > cur;
        const last = i === this.SET_STEPS.length - 1;
        return {
          label: s.label,
          status: s.status,
          isDone: done,
          isActive: active,
          isPending: pending,
          showStatus: active,
          showLine: !last,
          lineStyle: {
            width: '2px',
            flex: 1,
            minHeight: '14px',
            marginTop: '2px',
            background: done ? t.g1 : t.bd,
          } as React.CSSProperties,
          labelStyle: {
            fontSize: '12.5px',
            fontWeight: done || active ? 600 : 400,
            color: pending ? t.mut : t.tx,
          } as React.CSSProperties,
        };
      });
    }

    if (m.kind === 'complete' && m.method) {
      const crypto = m.method === 'crypto';
      const map: Record<PayMethod, string> = {
        pix: 'Pix',
        credito: 'Cartão de crédito',
        debito: 'Cartão de débito',
        crypto: 'USDC · Stellar',
      };
      base.isCrypto = crypto;
      base.subline = m.subline;
      base.cashbackUsdc = calc.cashbackUsdc;
      const lnV: React.CSSProperties = {
        fontSize: '12.5px',
        fontWeight: 600,
        flex: 1,
        minWidth: 0,
        textAlign: 'right',
        lineHeight: 1.35,
      };
      base.lines = [
        {
          label: 'Pedido',
          value: '#' + (m.orderId || '—'),
          valStyle: { ...lnV, fontFamily: "'Space Mono',monospace", fontSize: '11px' },
        },
        { label: 'Total pago', value: calc.totalStr, valStyle: lnV },
        { label: 'Forma de pagamento', value: map[m.method], valStyle: lnV },
        {
          label: 'Entrega estimada',
          value: c.shipping ? c.shipping.sub : '—',
          valStyle: { ...lnV, color: t.g2 },
        },
      ];
    }

    return base;
  }

  payIcon(type: 'pix' | 'card' | 'crypto', t: ThemeTokens): React.ReactElement {
    const R = React.createElement;
    if (type === 'pix')
      return R(
        'svg',
        {
          width: 17,
          height: 17,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: '#1ED760',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        R('path', { d: 'M12 3l3 3-3 3-3-3z' }),
        R('path', { d: 'M6 9l3 3-3 3-3-3z' }),
        R('path', { d: 'M18 9l3 3-3 3-3-3z' }),
        R('path', { d: 'M12 15l3 3-3 3-3-3z' }),
      );
    if (type === 'crypto')
      return R(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 24 24', fill: '#fff' },
        R('path', { d: 'M12 2l2.4 7.2H22l-6 4.4 2.3 7.2L12 16.4 5.7 20.8 8 13.6 2 9.2h7.6z' }),
      );
    return R(
      'svg',
      {
        width: 18,
        height: 14,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: t.g2,
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      R('rect', { x: 2, y: 5, width: 20, height: 14, rx: 2 }),
      R('path', { d: 'M2 10h20' }),
    );
  }

  settIcon(name: string, t: ThemeTokens): React.ReactElement {
    const R = React.createElement;
    const p = {
      width: 15,
      height: 15,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: t.mut,
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    };
    if (name === 'addr')
      return R('svg', p, R('path', { d: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' }), R('circle', { cx: 12, cy: 10, r: 3 }));
    if (name === 'pay')
      return R('svg', p, R('rect', { x: 2, y: 5, width: 20, height: 14, rx: 2 }), R('path', { d: 'M2 10h20' }));
    if (name === 'globe')
      return R(
        'svg',
        p,
        R('circle', { cx: 12, cy: 12, r: 9 }),
        R('path', { d: 'M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18' }),
      );
    if (name === 'bell')
      return R(
        'svg',
        p,
        R('path', { d: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9' }),
        R('path', { d: 'M13.7 21a2 2 0 0 1-3.4 0' }),
      );
    if (name === 'lock')
      return R('svg', p, R('rect', { x: 4, y: 10, width: 16, height: 11, rx: 2 }), R('path', { d: 'M8 10V7a4 4 0 0 1 8 0v3' }));
    if (name === 'user')
      return R('svg', p, R('circle', { cx: 12, cy: 8, r: 4 }), R('path', { d: 'M4 21c0-4 4-6 8-6s8 2 8 6' }));
    if (name === 'mail')
      return R('svg', p, R('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }), R('path', { d: 'M3 7l9 6 9-6' }));
    if (name === 'phone')
      return R(
        'svg',
        p,
        R('path', {
          d: 'M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
        }),
      );
    return R('svg', p, R('circle', { cx: 12, cy: 12, r: 9 }));
  }

  tabStyle(active: boolean, t: ThemeTokens): React.CSSProperties {
    return {
      flex: 1,
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: '12.5px',
      fontWeight: 600,
      padding: '9px',
      borderRadius: '10px',
      border: 'none',
      color: active ? '#fff' : t.mut,
      background: active ? t.g1 : 'transparent',
    };
  }

  getRenderState(): Record<string, unknown> {
    const t = this.tokens();
    const c = this.state.cart;
    const calc = this.calc(c);
    const view = this.state.view;
    const mode = this.state.chatMode;
    const faceOn = this.faceLoginEnabled;
    const atLogin = view === 'login' && faceOn;
    const FACE_CIRC = 295.3;

    const maxT = this.sheetH - this.peek;
    const baseT = this.state.open ? 0 : maxT;
    let tr = Math.max(0, Math.min(maxT, baseT + (this.state.drag || 0)));
    const frac = 1 - tr / maxT;
    const dragging = this.state.drag !== null;
    const ease = dragging ? 'none' : 'transform .42s cubic-bezier(.4,0,.1,1)';

    const cartRows: { label: string; value: string; valStyle: React.CSSProperties }[] = [];
    const cvS: React.CSSProperties = { fontSize: '12.5px', fontWeight: 600, flex: 'none', whiteSpace: 'nowrap' };
    if (c.bundle) cartRows.push({ label: 'Combo · ' + c.bundle.title, value: this.brl(c.bundle.price), valStyle: cvS });
    if (c.coupon)
      cartRows.push({ label: 'Promoção · ' + c.coupon.code, value: this.brl(c.coupon.amount), valStyle: { ...cvS, color: '#1ED760' } });
    if (c.shipping)
      cartRows.push({
        label: 'Frete · ' + c.shipping.label,
        value: calc.ship ? this.brl(calc.ship) : 'Grátis',
        valStyle: cvS,
      });
    if (c.payMethod) {
      const map: Record<PayMethod, string> = { pix: 'Pix', credito: 'Crédito', debito: 'Débito', crypto: 'USDC · Stellar' };
      cartRows.push({ label: 'Pagamento', value: map[c.payMethod], valStyle: { fontSize: '12.5px', fontWeight: 600 } });
    }

    let cartState = 'Sem produto';
    if (this.state.completed) cartState = 'Pedido confirmado';
    else if (c.payMethod) cartState = 'Pronto p/ pagar';
    else if (c.shipping) cartState = 'Frete calculado';
    else if (c.coupon) cartState = 'Promoção aplicada';
    else if (c.product) cartState = 'Aguardando';

    const actions = this.state.actions.map((a) => ({
      label: a.label,
      fn: a.fn,
      style: a.primary
        ? ({
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '12.5px',
            fontWeight: 600,
            color: '#fff',
            padding: '9px 15px',
            borderRadius: '20px',
            background: t.g1,
          } as React.CSSProperties)
        : ({
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '12.5px',
            fontWeight: 500,
            color: t.tx,
            padding: '9px 15px',
            borderRadius: '20px',
            background: t.chip,
            border: '1px solid ' + t.bd,
          } as React.CSSProperties),
    }));

    const capIcon = (d: string, stroke: string): React.ReactElement =>
      React.createElement(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke,
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        React.createElement('path', { d }),
      );

    const introCaps = [
      {
        label: 'Acho a melhor opção e aplico promoções',
        tint: 'rgba(30,215,96,.18)',
        icon: capIcon('M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8L12 14.6 7 18.2l1.9-5.8L4 8.8h6.1z', '#1ED760'),
      },
      {
        label: 'Coleto seus dados e calculo o frete',
        tint: 'rgba(45,212,255,.16)',
        icon: capIcon('M3 7h11v8H3zM14 10h4l3 3v2h-7z', '#22b8cf'),
      },
      {
        label: 'Pago com Pix, cartão ou crypto',
        tint: 'rgba(30,215,96,.16)',
        icon: capIcon('M2 7h20v10H2z M2 11h20', '#1ED760'),
      },
    ];

    const statusStyle = (tone: string): React.CSSProperties => ({
      fontFamily: "'Space Mono',monospace",
      fontSize: '8.5px',
      marginTop: '2px',
      color: tone === 'done' ? t.dot : t.g2,
    });

    const orders = this.state.orders.map((o) => ({ ...o, avatarBg: o.bg, statusStyle: statusStyle(o.tone) }));

    const rowBase: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '13px',
      background: t.card,
      cursor: 'pointer',
      borderBottom: '1px solid ' + t.bd,
    };
    const lastRow: React.CSSProperties = { ...rowBase, borderBottom: 'none' };

    const sg = (rows: { ic: string; label: string; value: string; mkey: ModalKey }[]) =>
      rows.map((r, i) => ({
        ...r,
        icon: this.settIcon(r.ic, t),
        fn: this.openModal(r.mkey),
        style: i === rows.length - 1 ? lastRow : rowBase,
      }));

    const sw = (on: boolean) => ({
      switchStyle: {
        width: '42px',
        height: '25px',
        borderRadius: '13px',
        border: 'none',
        cursor: 'pointer',
        padding: '2px',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: on ? 'flex-end' : 'flex-start',
        background: on ? t.g1 : t.bd,
        transition: 'background .2s',
      } as React.CSSProperties,
      knobStyle: {
        width: '21px',
        height: '21px',
        borderRadius: '50%',
        background: '#fff',
        display: 'block',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
      } as React.CSSProperties,
    });

    const optS = (active: boolean): React.CSSProperties => ({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      width: '100%',
      textAlign: 'left',
      cursor: 'pointer',
      fontFamily: 'inherit',
      padding: '12px 13px',
      borderRadius: '12px',
      border: '1px solid ' + (active ? t.g1 : t.bd),
      background: active ? 'rgba(30,215,96,.1)' : t.card,
    });

    const cust = this.state.customer;
    const P = this.PROFILE_DEFAULTS;
    const prefs = this.state.prefs;
    const profileName = cust.name && cust.name.length ? cust.name : P.name;
    const profileEmail = cust.email && cust.email.length ? cust.email : P.email;
    const profilePhone = cust.phone && cust.phone.length ? cust.phone : P.phone;
    const addrShort = cust.cep ? (cust.number ? cust.number + ' · ' : '') + cust.cep : '—';
    const langLabel = prefs.lang === 'pt-BR' ? 'Português (BR)' : prefs.lang === 'en-US' ? 'English (US)' : 'Español';
    const notifOn = [prefs.notifPromo && 'Promoções', prefs.notifStatus && 'Status', prefs.notifPush && 'Push'].filter(
      Boolean,
    ) as string[];

    const settingGroups = [
      {
        title: 'Meus dados',
        rows: sg([
          { ic: 'user', label: 'Nome', value: profileName, mkey: 'profile' },
          { ic: 'mail', label: 'E-mail', value: profileEmail, mkey: 'profile' },
          { ic: 'phone', label: 'Telefone', value: profilePhone, mkey: 'profile' },
          { ic: 'addr', label: 'Endereço de entrega', value: addrShort, mkey: 'address' },
        ]),
      },
      {
        title: 'Pagamento',
        rows: sg([{ ic: 'pay', label: 'Métodos de pagamento', value: 'Pix · Cartão ·· 4242 · USDC', mkey: 'payment' }]),
      },
      {
        title: 'Preferências',
        rows: sg([
          { ic: 'globe', label: 'Moeda e idioma', value: prefs.currency + ' · ' + langLabel, mkey: 'locale' },
          { ic: 'bell', label: 'Notificações', value: notifOn.length ? notifOn.join(' · ') : 'Desativadas', mkey: 'notif' },
          { ic: 'lock', label: 'Segurança e 2FA', value: prefs.twoFA ? '2FA ativado' : '2FA desativado', mkey: 'security' },
        ]),
      },
    ];

    const rec = this.state.recommendation;
    const searchResults = this.state.searchResults.map((r) => ({
      ...r,
      priceStr: this.brl(r.price),
      onAdd: this.onAddSearched(r),
    }));

    const modalTitles: Record<ModalKey, string> = {
      profile: 'Dados pessoais',
      address: 'Endereço de entrega',
      payment: 'Métodos de pagamento',
      locale: 'Moeda e idioma',
      notif: 'Notificações',
      security: 'Segurança e acesso',
    };

    const modalSubs: Record<ModalKey, string> = {
      profile: 'Editar nome, e-mail e telefone',
      address: 'Onde você quer receber',
      payment: 'Escolha o método padrão',
      locale: 'Como você vê preços e textos',
      notif: 'O que a Pulse te avisa',
      security: 'Proteja a sua conta',
    };

    const activeField = this.state.askingField
      ? this.FIELDS.find((x) => x.key === this.state.askingField)
      : undefined;

    return {
      widgetStyle: {
        '--bg': t.bg,
        '--tx': t.tx,
        '--mut': t.mut,
        '--card': t.card,
        '--bd': t.bd,
        '--chip': t.chip,
        '--sheet': t.sheet,
        '--sheetbd': t.sheetbd,
        '--dot': t.dot,
        '--g1': t.g1,
        '--g2': t.g2,
        '--g3': t.g3,
        '--tile1': t.tile1,
        '--tile2': t.tile2,
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: '28px',
        overflow: 'hidden',
        background: t.bg,
        color: t.tx,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Space Grotesk',sans-serif",
      } as React.CSSProperties,

      isLogin: atLogin,
      isIntro: view === 'intro' || (view === 'login' && !faceOn),
      isChat: view === 'chat',
      isHub: view === 'hub',
      chatLoading: mode === 'loading',
      chatEmpty: mode === 'empty',
      chatFlow: mode === 'flow',
      showHeader: view !== 'intro' && view !== 'login',
      headerOrbPlacement: (view === 'chat' && mode === 'empty' ? 'headerEmpty' : 'header') as AgentOrbPlacement,
      headerTitle: view === 'hub' ? 'Minha conta' : this.agentName + ' · Gerente de vendas',
      headerSub: view === 'hub' ? 'Pedidos e configurações' : 'Online · ' + this.storeName,
      storeName: this.storeName,
      agentName: this.agentName,
      introCaps,

      chatStyle: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: this.peek + 'px',
        overflowY: 'auto',
        padding: '16px 16px 22px',
        transform: `translateY(${(-44 * frac).toFixed(1)}px)`,
        transition: ease,
      } as React.CSSProperties,
      messages: this.state.log.map((m, idx) => {
        const built = this.buildMsg(m, t);
        const fieldConfirmed = m.kind === 'field' && m.field !== this.state.askingField;
        const isAgentBlock = m.role === 'agent' && !fieldConfirmed;
        if (isAgentBlock) {
          const lastAgentIdx = (() => {
            for (let i = this.state.log.length - 1; i >= 0; i--) {
              const lm = this.state.log[i];
              const fc = lm.kind === 'field' && lm.field !== this.state.askingField;
              if (lm.role === 'agent' && !fc) return i;
            }
            return -1;
          })();
          const isCurrent = idx === lastAgentIdx && !this.state.typing;
          built.showAvatar = isCurrent;
          built.spacerAvatar = !isCurrent;
          built.isCurrentAgent = isCurrent;
        }
        return built;
      }),
      typing: this.state.typing,
      actions,
      hasActions: actions.length > 0 && !this.state.typing,
      fieldValue: this.state.askingField ? cust[this.state.askingField as keyof Customer] || '' : '',
      fieldProgress: this.state.askingField
        ? 'Passo ' + (this.FIELDS.findIndex((f) => f.key === this.state.askingField) + 1) + '/' + this.FIELDS.length
        : '',
      onFieldInput: this.onFieldInput,
      onFieldKey: this.onFieldKey,
      confirmField: this.confirmField,
      fieldBack: this.fieldBack,
      canFieldBack: !!this.state.askingField && this.FIELDS.findIndex((f) => f.key === this.state.askingField) > 0,

      searchQuery: this.state.searchQuery,
      searching: this.state.searching,
      hasResults: this.state.searchResults.length > 0,
      searchResults,
      onSearch: this.onSearch,
      onSearchInput: this.onSearchInput,
      onSearchKey: this.onSearchKey,
      dictateSearch: this.dictateSearch,
      searchPlaceholder: this.state.dictating ? 'Ouvindo… pode falar' : 'Buscar produto… (ex: câmera, lâmpada)',
      micIconColor: this.state.dictating ? '#fff' : t.g2,
      micBtnStyle: {
        width: '36px',
        height: '36px',
        borderRadius: '10px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        padding: 0,
        border: this.state.dictating ? 'none' : '1px solid ' + t.bd,
        background: this.state.dictating ? '#ff4c6c' : t.chip,
        animation: this.state.dictating ? 'micRec 1.2s ease-out infinite' : 'none',
      } as React.CSSProperties,

      productTitle: c.product ? c.product.title : '',
      productSubtitle: c.product ? c.product.subtitle : '',
      productPrice: c.product ? this.brl(c.product.price) : '',
      couponCode: c.coupon ? c.coupon.code : '',
      couponStr: c.coupon ? this.brl(Math.abs(c.coupon.amount)) : '',
      showCouponUrgency: this.couponStillValid(),
      couponCountdown: this.getCouponCountdown(),
      couponBonusStr: c.coupon?.pendingAmount ? this.brl(Math.abs(c.coupon.pendingAmount)) : '',
      couponBonusPercent: String(c.coupon?.pendingPercent ?? this.tenantDiscount().bonusPercent),
      recTitle: rec ? rec.title : '',
      recSubtitle: rec ? rec.subtitle : '',
      recNowStr: rec ? this.brl(rec.price) : '',
      recWasStr: rec ? this.brl(rec.was) : '',
      recBadgeStr: rec ? this.brl(rec.was - rec.price) : '',
      totalStr: calc.totalStr,
      cashbackStr: calc.cashbackStr,
      cryptoUsdc: calc.usdc,
      addrName: profileName,
      addrLine1: cust.number ? cust.number + (cust.complement ? ' — ' + cust.complement : '') : '',
      addrLine2: cust.cep || '',

      scrimStyle: {
        position: 'absolute',
        inset: 0,
        background: `rgba(${t.scrim},${(0.5 * frac).toFixed(3)})`,
        backdropFilter: frac > 0.05 ? `blur(${(2 * frac).toFixed(1)}px)` : 'none',
        pointerEvents: frac > 0.05 ? 'auto' : 'none',
        zIndex: 5,
        transition: 'background .42s, backdrop-filter .42s',
      } as React.CSSProperties,
      sheetStyle: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: this.sheetH + 'px',
        zIndex: 6,
        background: t.sheet,
        borderTop: '1px solid ' + t.sheetbd,
        borderRadius: '24px 24px 0 0',
        transform: `translateY(${tr.toFixed(1)}px)`,
        transition: ease,
        boxShadow: '0 -18px 50px -20px rgba(0,0,0,.45)',
        display: 'flex',
        flexDirection: 'column',
      } as React.CSSProperties,
      chevronStyle: {
        transform: `rotate(${(frac * 180).toFixed(0)}deg)`,
        transition: dragging ? 'none' : 'transform .42s',
        display: 'flex',
      } as React.CSSProperties,
      cartState,
      cartCount: (c.product ? c.qty : 0) + (c.bundle ? 1 : 0),
      qty: c.qty,
      cartEmpty: !c.product,
      cartHasProduct: !!c.product,
      cartRows,
      removeProduct: this.removeProduct,

      hubOrders: this.state.hubTab === 'orders',
      hubSettings: this.state.hubTab === 'settings',
      ordersTabStyle: this.tabStyle(this.state.hubTab === 'orders', t),
      settingsTabStyle: this.tabStyle(this.state.hubTab === 'settings', t),
      orders,
      settingGroups,

      modalOpen: !!this.state.activeModal,
      mProfile: this.state.activeModal === 'profile',
      mAddress: this.state.activeModal === 'address',
      mPayment: this.state.activeModal === 'payment',
      mLocale: this.state.activeModal === 'locale',
      mNotif: this.state.activeModal === 'notif',
      mSecurity: this.state.activeModal === 'security',
      modalSavable: this.state.activeModal === 'profile' || this.state.activeModal === 'address',
      modalTitle: this.state.activeModal ? modalTitles[this.state.activeModal] : '',
      modalSub: this.state.activeModal ? modalSubs[this.state.activeModal] : '',
      closeModal: this.closeModal,
      saveModal: this.saveModal,
      d: this.state.draft,
      onDraftName: this.setDraft('name'),
      onDraftEmail: this.setDraft('email'),
      onDraftPhone: this.setDraft('phone'),
      onDraftCep: this.setDraft('cep'),
      onDraftNumber: this.setDraft('number'),
      onDraftComplement: this.setDraft('complement'),
      notifRows: [
        {
          label: 'Promoções e cupons',
          sub: 'Ofertas que a Pulse encontrar',
          ...sw(prefs.notifPromo),
          fn: this.togglePref('notifPromo'),
        },
        {
          label: 'Status de pedidos',
          sub: 'Pagamento, envio e entrega',
          ...sw(prefs.notifStatus),
          fn: this.togglePref('notifStatus'),
        },
        {
          label: 'Notificações push',
          sub: 'Alertas no dispositivo',
          ...sw(prefs.notifPush),
          fn: this.togglePref('notifPush'),
        },
      ],
      securityRows: [
        {
          label: 'Autenticação em 2 fatores',
          sub: 'Código por SMS ao entrar',
          ...sw(prefs.twoFA),
          fn: this.togglePref('twoFA'),
        },
        {
          label: 'Login por reconhecimento facial',
          sub: 'Entrar usando o rosto',
          ...sw(prefs.faceUnlock),
          fn: this.togglePref('faceUnlock'),
        },
      ],
      currencyOpts: [
        { label: 'Real brasileiro', code: 'BRL' },
        { label: 'US Dollar', code: 'USD' },
        { label: 'Euro', code: 'EUR' },
      ].map((o) => ({
        label: o.label,
        code: o.code,
        active: prefs.currency === o.code,
        style: optS(prefs.currency === o.code),
        fn: this.setPref('currency', o.code),
      })),
      langOpts: [
        { label: 'Português (BR)', code: 'pt-BR' },
        { label: 'English (US)', code: 'en-US' },
        { label: 'Español', code: 'es' },
      ].map((o) => ({
        label: o.label,
        code: o.code,
        active: prefs.lang === o.code,
        style: optS(prefs.lang === o.code),
        fn: this.setPref('lang', o.code),
      })),
      payOpts: [
        { label: 'Pix', sub: 'Aprovação na hora', val: 'pix' },
        { label: 'Cartão de crédito', sub: 'Crédito · até 12x', val: 'credito' },
        { label: 'USDC · Stellar', sub: 'Cashback de 3%', val: 'crypto' },
      ].map((o) => ({
        label: o.label,
        sub: o.sub,
        val: o.val,
        active: prefs.defaultPay === o.val,
        style: optS(prefs.defaultPay === o.val),
        fn: this.setPref('defaultPay', o.val),
      })),

      recovery: !!c.product && !this.state.completed,
      recoveryTotal: calc.totalStr,
      profileName,
      profileEmail,
      profileInitial: profileName.slice(0, 1).toUpperCase(),

      faceHint: this.state.faceHint,
      faceScanning: this.state.faceStatus === 'scanning',
      faceSuccess: this.state.faceStatus === 'success',
      faceBusy: this.state.faceStatus === 'scanning' || this.state.faceStatus === 'matching',
      faceDash: (FACE_CIRC * (1 - this.state.faceProgress / 100)).toFixed(1),
      camIdle: !this.state.camActive,
      camRef: (el: HTMLVideoElement | null) => {
        this.refs.cam = el;
      },
      camWrapStyle: { position: 'relative', width: '200px', height: '200px', borderRadius: '50%', flex: 'none' } as React.CSSProperties,
      camVideoStyle: {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        borderRadius: '50%',
        transform: 'scaleX(-1)',
        opacity: this.state.camActive ? 1 : 0,
        transition: 'opacity .4s',
        background: '#000',
      } as React.CSSProperties,
      faceBtnLabel:
        this.state.faceStatus === 'success'
          ? 'Confirmado'
          : this.state.faceStatus === 'idle'
            ? 'Entrar com Face ID'
            : 'Escaneando…',
      faceBtnStyle: {
        border: 'none',
        cursor: this.state.faceStatus === 'idle' ? 'pointer' : 'default',
        fontFamily: 'inherit',
        fontSize: '14px',
        fontWeight: 600,
        color: '#fff',
        padding: '14px 24px',
        borderRadius: '14px',
        background: t.g1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '9px',
        opacity: this.state.faceStatus === 'idle' ? 1 : 0.72,
        minWidth: '210px',
      } as React.CSSProperties,
      startFace: this.startFace,
      skipLogin: this.skipLogin,

      phoneStep: this.state.phoneStep,
      phoneNumber: this.state.phoneNumber,
      phoneCode: this.state.phoneCode,
      phoneError: this.state.phoneError,
      startPhoneLogin: this.startPhoneLogin,
      onPhoneInput: this.onPhoneInput,
      onPhoneCodeInput: this.onPhoneCodeInput,
      submitPhone: this.submitPhone,
      submitCode: this.submitCode,

      voiceDisabled: !this.voiceEnabled,
      startVoiceChat: this.startVoiceChat,
      toggleVoiceMode: this.toggleVoiceMode,
      showVoiceToggle: this.voiceEnabled && view === 'chat' && mode !== 'loading',
      voiceModeTitle: this.state.shopMode === 'voice' ? 'Modo voz ativo — tocar para desligar' : 'Ativar modo voz',
      voiceToggleColor: this.state.shopMode === 'voice' ? '#fff' : t.mut,
      voiceToggleStyle: {
        width: '30px',
        height: '30px',
        borderRadius: '50%',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        padding: 0,
        border: this.state.shopMode === 'voice' ? 'none' : '1px solid ' + t.bd,
        background: this.state.shopMode === 'voice' ? t.g1 : t.chip,
      } as React.CSSProperties,

      fieldPlaceholderLive: this.state.dictatingField
        ? 'Ouvindo… pode responder'
        : activeField
          ? activeField.ph
          : '',
      dictateField: this.dictateField,
      fieldMicColor: this.state.dictatingField ? '#fff' : t.g2,
      fieldMicStyle: {
        width: '34px',
        height: '34px',
        borderRadius: '10px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        padding: 0,
        border: this.state.dictatingField ? 'none' : '1px solid ' + t.bd,
        background: this.state.dictatingField ? '#ff4c6c' : t.chip,
        animation: this.state.dictatingField ? 'micRec 1.2s ease-out infinite' : 'none',
      } as React.CSSProperties,

      voiceEnabled: this.voiceEnabled,
      voiceOpen: this.state.voiceOpen,
      voiceTag: this.state.voiceStatus === 'processing' ? this.agentName + ' · processando' : this.agentName + ' · ouvindo',
      voiceStatusText:
        this.state.voiceStatus === 'processing'
          ? 'Buscando os melhores produtos pra você…'
          : 'Pode falar — diga o que você procura',
      voiceTranscript:
        this.state.voiceTranscript || (this.state.voiceStatus === 'processing' ? '' : 'Diga o nome de um produto…'),
      waveRef: (el: HTMLDivElement | null) => {
        this.refs.wave = el;
      },
      openVoiceShop: this.openVoiceShop,
      stopVoice: this.stopVoice,

      fabVisible: this.supportEnabled && !atLogin && !this.state.supportOpen && !this.state.voiceOpen && !this.state.open,
      fabStyle: {
        position: 'absolute',
        right: '16px',
        bottom: view === 'chat' && mode === 'flow' ? this.peek + 14 + 'px' : '18px',
        zIndex: 30,
        width: '52px',
        height: '52px',
        borderRadius: '50%',
        border: 'none',
        cursor: 'pointer',
        background: t.g1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fabPulse 2.6s ease-out infinite',
      } as React.CSSProperties,
      openSupport: this.openSupport,
      closeSupport: this.closeSupport,
      supportOpen: this.state.supportOpen,
      supportTyping: this.state.supportTyping,
      supportEmpty: this.state.supportLog.length === 0,
      supportInput: this.state.supportInput,
      onSupportInput: this.onSupportInput,
      onSupportKey: this.onSupportKey,
      sendSupport: this.sendSupport,
      supportRef: (el: HTMLDivElement | null) => {
        this.refs.support = el;
      },
      supportChips: [
        { label: 'Onde está o meu pedido?', fn: this.askSupport('Onde está o meu pedido?') },
        { label: 'Como funciona o cashback em USDC?', fn: this.askSupport('Como funciona o cashback?') },
        { label: 'Posso parcelar a compra?', fn: this.askSupport('Posso parcelar?') },
        { label: 'É seguro pagar com crypto?', fn: this.askSupport('É seguro pagar com crypto?') },
      ],
      supportMsgs: this.state.supportLog.map((sm) => {
        const u = sm.role === 'user';
        return {
          text: sm.text,
          rowStyle: { display: 'flex', justifyContent: u ? 'flex-end' : 'flex-start', marginTop: '10px' } as React.CSSProperties,
          bubbleStyle: u
            ? ({
                maxWidth: '82%',
                background: t.g1,
                color: '#fff',
                fontSize: '13px',
                lineHeight: 1.5,
                padding: '10px 13px',
                borderRadius: '16px 16px 4px 16px',
                fontWeight: 500,
              } as React.CSSProperties)
            : ({
                maxWidth: '88%',
                background: t.card,
                color: t.tx,
                fontSize: '13px',
                lineHeight: 1.55,
                padding: '11px 13px',
                borderRadius: '16px 16px 16px 4px',
                border: '1px solid ' + t.bd,
              } as React.CSSProperties),
        };
      }),

      chatRef: (el: HTMLDivElement | null) => {
        this.refs.chat = el;
      },
      restart: this.restart,
      toggleTheme: this.toggleTheme,
      startChat: this.startChat,
      goHub: this.goHub,
      goChat: this.goChat,
      setOrdersTab: this.setOrdersTab,
      setSettingsTab: this.setSettingsTab,
      resumeCart: this.resumeCart,
      startDrag: this.startDrag,
      closeCart: this.closeCart,
      inc: this.inc,
      dec: this.dec,

      pixQrCode: this.state.pixQrCode,
      pixCopyPaste: this.state.pixCopyPaste,
      pixExpiresAt: this.state.pixExpiresAt,
      pixStatus: this.state.pixStatus,

      privacyUrl: this.props.privacyUrl,
      theme: this.theme,
    };
  }
}
