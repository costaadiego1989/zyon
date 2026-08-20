export function createRecognition(): any {
  if (typeof window === "undefined") return null;
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = "pt-BR";
  r.continuous = false;
  r.maxAlternatives = 1;
  return r;
}

export function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "pt-BR";
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}
