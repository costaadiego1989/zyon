import { useState, useCallback } from "react";

export interface NativeAuthState {
  domain: string;
}

export function useNativeAuth() {
  const [state, setState] = useState<NativeAuthState>({
    domain: "",
  });

  const setDomain = useCallback((value: string) => {
    setState({ domain: value });
  }, []);

  const reset = useCallback(() => {
    setState({ domain: "" });
  }, []);

  return {
    state,
    setDomain,
    reset,
  };
}
