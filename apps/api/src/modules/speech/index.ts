// Giao diện công khai của module speech (ADR-0008, ADR-0025)
export { SpeechModule, createSpeechProvider } from './speech.module.js';
export {
  SPEECH_PROVIDER,
  SpeechProviderError,
  defaultVoiceFor,
  normalizeScript,
  countWords,
  type SpeechProvider,
  type SpeechProviderName,
  type SynthesisResult,
  type AudioInput,
  type PronunciationAssessment,
  type PronunciationWord,
} from './speech-provider.js';
export { MockSpeechProvider, MOCK_MS_PER_WORD, wavDurationMs } from './providers/mock-speech.provider.js';
export { AzureSpeechProvider, buildSsml, parseAssessmentResponse, pronunciationAssessmentHeader, type FetchLike } from './providers/azure-speech.provider.js';
export { pronunciationBandFromPa, type PronunciationBand } from './pronunciation.js';
export { TtsService, ttsTextHash, type TtsResult } from './tts.service.js';
export { MediaAssetsService, type CreateUploadInput, type CreateUploadResult, type MediaAssetView } from './media/media-assets.service.js';
export { MediaProcessorService, mediaJobHandlers, ffmpegConfigFromEnv, type ProcessOutcome } from './media/media-processor.service.js';
export { ALLOWED_AUDIO_MIME, ALLOWED_IMAGE_MIME, MEDIA_PROCESS_JOB, MEDIA_QUEUE, WAVEFORM_PEAKS, THUMBNAIL_WIDTH, readMetadata, type MediaMetadata } from './media/media.types.js';
export * as ffmpeg from './media/ffmpeg.js';
