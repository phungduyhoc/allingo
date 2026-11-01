import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { InternalMediaController, SpeechInternalTokenGuard } from './internal-media.controller.js';
import { MediaAssetsService } from './media/media-assets.service.js';
import { ffmpegConfigFromEnv, MediaProcessorService } from './media/media-processor.service.js';
import { AzureSpeechProvider } from './providers/azure-speech.provider.js';
import { MockSpeechProvider } from './providers/mock-speech.provider.js';
import { SPEECH_PROVIDER, type SpeechProvider } from './speech-provider.js';
import { TtsService } from './tts.service.js';

/**
 * Chọn SpeechProvider: SPEECH_PROVIDER=azure + AZURE_SPEECH_KEY/REGION → Azure REST; còn lại mock.
 * azure thiếu khoá: production → lỗi khởi động (tránh phát audio im lặng); môi trường khác → cảnh báo + mock.
 */
export function createSpeechProvider(env: Env): SpeechProvider {
  if (env.SPEECH_PROVIDER === 'azure') {
    if (env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION) return new AzureSpeechProvider({ key: env.AZURE_SPEECH_KEY, region: env.AZURE_SPEECH_REGION });
    if (env.APP_ENV === 'production') throw new Error('SPEECH_PROVIDER=azure requires AZURE_SPEECH_KEY and AZURE_SPEECH_REGION');
    getLogger({ component: 'speech' }).warn('SPEECH_PROVIDER=azure but AZURE_SPEECH_KEY/REGION missing → using mock provider');
  }
  return new MockSpeechProvider(ffmpegConfigFromEnv(env));
}

/** Module speech (ADR-0008, ADR-0025): SpeechProvider (TTS, Pronunciation Assessment), TTS cache, pipeline media */
@Module({
  controllers: [InternalMediaController],
  providers: [{ provide: SPEECH_PROVIDER, inject: [ENV], useFactory: createSpeechProvider }, MediaProcessorService, MediaAssetsService, TtsService, SpeechInternalTokenGuard],
  exports: [SPEECH_PROVIDER, MediaProcessorService, MediaAssetsService, TtsService],
})
export class SpeechModule {}
