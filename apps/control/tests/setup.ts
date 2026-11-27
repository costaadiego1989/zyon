// React 18 requires explicit acknowledgement for concurrent act() in jsdom.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
