# speech
`SpeechProvider` (ADR-0008, ADR-0025): TTS + Pronunciation Assessment qua Azure AI Speech REST; `MockSpeechProvider` ở dev/test. STT (`transcribe`) bổ sung ở S6/S9.

- `tts.service.ts` – `TtsService.forScript(text, voice?, locale)` cache `ai.tts_cache`, tệp `media/tts/<hh>/<hash>.mp3`; `createAsset()` tạo `catalog.media_assets` audio `ready`.
- `media/` – vòng đời `catalog.media_assets` (uploading → processing → ready | failed), job `media.process` (queue `media`, jobId = asset id): audio → MP3 48 kbps mono + duration + waveform 200 đỉnh; ảnh → WebP + thumbnail 320 px. ffmpeg/ffprobe: `media/ffmpeg.ts`.
- `pronunciation.ts` – PA → band IELTS qua `@allingo/scoring.paToIeltsBand`.
- API nội bộ cho CMS (`X-Internal-Token`, ngoài OpenAPI): `POST /v1/internal/media/presign`, `POST /v1/internal/media/process` (202), `GET /v1/internal/media/:id`, `POST /v1/internal/media/tts`.
