import type { CheckoutProps } from '../model/types';

export type StateUpdater<T> = Partial<T> | ((prev: T) => Partial<T>);

export abstract class ViewModelBase<S> {
  protected _state: S;
  private listeners = new Set<() => void>();
  version = 0;
  props: CheckoutProps;

  constructor(props: CheckoutProps, initial: S) {
    this.props = props;
    this._state = initial;
  }

  get state(): S {
    return this._state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected notify(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  setState(update: StateUpdater<S>, callback?: () => void): void {
    const patch = typeof update === 'function' ? update(this._state) : update;
    this._state = { ...this._state, ...patch };
    this.notify();
    callback?.();
  }

  abstract mount(): void;
  abstract unmount(): void;
  abstract onUpdate(): void;
}
