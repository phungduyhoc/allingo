# ADR-0025: Media pipeline (ffmpeg trong worker), driver lưu trữ fs cho dev/test, TTS cache và Azure Speech qua REST

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Sprint 2 – media pipeline, TTS, PoC GATE-1 (bổ sung ADR-0008, ADR-0016)

## Context
- Sprint 2 cần: tải lên trực tiếp ghi âm/ảnh (`POST /uploads/presign`, ≤ 20 MB), chuẩn hoá audio nội dung (MP3 48 kbps mono + duration + waveform), ảnh WebP + thumbnail, TTS cho `audio_script` và Pronunciation Assessment cho PoC-P.
- Phiên dev/CI không có MinIO/Docker; vẫn phải test end-to-end luồng "presign → PUT trực tiếp → xử lý → phát URL ký".
- `catalog.media_assets` (v1.0) không có trạng thái xử lý.

## Decision
1. **ffmpeg/ffprobe trong image worker**, gọi bằng tiến trình con (mảng đối số, không shell) ở job BullMQ `media.process` (queue `media`, `jobId` = `media_asset_id`). Không thêm `sharp`: ffmpeg đủ cho WebP/thumbnail 320 px và bớt một native dependency.
   - An toàn đầu vào: nhận dạng chữ ký tệp (magic bytes) thay vì tin MIME khai báo; ép demuxer (`-f`) + `-protocol_whitelist file` để chặn playlist HLS/concat; giới hạn 20 MB, ≤ 3 giờ audio, ≤ 50 MP ảnh; bỏ metadata/EXIF.
   - Trạng thái: migration 0002 thêm `catalog.media_status (uploading|processing|ready|failed)`, `metadata jsonb` (bucket, original, variants, waveform 200 đỉnh, thumbnail_key, error, tts), `updated_at`. Sau xử lý `storage_key` trỏ biến thể phát được; bản gốc giữ trong `metadata.original`.
   - Lỗi vĩnh viễn (định dạng sai…) → `failed`, không retry; lỗi tạm → retry 3 lần. Redis không sẵn sàng → xử lý đồng bộ trong tiến trình API (cảnh báo) để không kẹt.
2. **`StorageService` 2 driver:** `s3` (MinIO/R2/S3; presign PUT ký cả `Content-Type` và `Content-Length`) và `fs` (dev/test: `STORAGE_FS_DIR`, URL ký HMAC-SHA256 khoá dẫn xuất HKDF từ `AUTH_SECRET`, có hạn, tới route nội bộ `PUT/GET /v1/storage/fs/:bucket/*` – chỉ đăng ký khi driver = fs, ngoài OpenAPI). `STORAGE_DRIVER` rỗng → `APP_ENV=test` dùng fs, còn lại s3. fs không dùng cho staging/prod.
3. **Dữ liệu cá nhân:** ghi âm và ảnh người học tải lên → bucket `recordings` (URL ký 10 phút); `learn.recordings.expires_at` 90 ngày (Free) / 365 ngày (Pro, theo `EntitlementService`).
4. **TTS:** `TtsService.forScript(text, voice)` cache `ai.tts_cache(text_hash, voice)` với `text_hash = sha256(provider|locale|văn bản chuẩn hoá)`; tệp bất biến `media/tts/<hh>/<hash>.mp3`; cùng script → cùng `media_asset` (idempotent). Cache hit nhưng thiếu tệp → sinh lại.
5. **Azure AI Speech qua REST** (không SDK native): TTS `https://{region}.tts.speech.microsoft.com/cognitiveservices/v1` (SSML, `audio-24khz-48kbitrate-mono-mp3` khớp pipeline) và Pronunciation Assessment trên REST short-audio (header `Pronunciation-Assessment` base64 JSON). `MockSpeechProvider` cho dev/test: MP3 im lặng ≈ số từ × 350 ms (ffmpeg `anullsrc`), PA giả lập xác định theo hash. `SPEECH_PROVIDER=azure` thiếu khoá: production lỗi khởi động, môi trường khác cảnh báo + mock.

## Alternatives considered
1. `sharp` cho ảnh + ffmpeg cho audio – thêm native binary, lợi ích nhỏ ở quy mô hiện tại; xét lại nếu cần xử lý ảnh nhiều/nhanh (EXIF orientation, AVIF).
2. Dịch vụ xử lý media managed (Cloudflare Images/Stream, AWS MediaConvert) – chi phí và phụ thuộc nhà cung cấp trước GATE-1.
3. Stub S3 bằng `aws-sdk-client-mock` trong test – không kiểm được upload trực tiếp/URL ký end-to-end.
4. Azure Speech SDK (`microsoft-cognitiveservices-speech-sdk`) – cần cho streaming/continuous PA (> 30 s) ở S6; REST đủ cho TTS và PoC.

## Consequences
- Image worker (`apps/api/Dockerfile` target worker) và runner CI phải cài `ffmpeg`; test cần ffmpeg tự `skip` nếu thiếu (cảnh báo trong báo cáo CI).
- Module `speech` ghi các cột xử lý của `catalog.media_assets` (ngoại lệ ranh giới §5.1, ghi trong SPEC-ISSUES); catalog chỉ đọc để phát URL và nên lọc `status = 'ready'`.
- Ảnh người học trong `catalog.media_assets` (bucket recordings, `metadata.origin = learner_upload`) cần được `iam.purge` xoá cùng ghi âm khi xoá tài khoản.
- Job xoá ghi âm hết hạn (`learn.recordings.expires_at`) và lifecycle bucket S3 làm ở S8.
