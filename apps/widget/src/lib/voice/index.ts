// Voice engine barrel — re-exports the entire voice infrastructure layer.

export { createSTTEngine } from "./stt-engine.js";
export type { STTEngine, STTEngineOptions, STTResult, STTError, STTEngineType, STTErrorCode } from "./stt-engine.js";

export { createTTSEngine, parseSSML } from "./tts-engine.js";
export type { TTSEngine, TTSEngineOptions, TTSEngineType, TTSError } from "./tts-engine.js";

export { createVoiceSession } from "./voice-session.js";
export type { VoiceSession, VoiceSessionState, VoiceTransition, VoiceSessionEvent, VoiceSessionOptions } from "./voice-session.js";

export { createVADDetector } from "./vad-detector.js";
export type { VADDetector, VADOptions, VADState } from "./vad-detector.js";

export { createTranscriptManager } from "./transcript-manager.js";
export type { TranscriptManager, TranscriptMessage, TranscriptRole, TranscriptSnapshot, TranscriptManagerOptions } from "./transcript-manager.js";
