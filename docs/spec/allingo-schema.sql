-- =============================================================================
-- Allingo – Nền tảng luyện thi AI (TOEIC · IELTS · JLPT · HSK)
-- PostgreSQL 16+ DDL tham chiếu · v1.0 · 31/10/2026
-- 6 schema: iam, catalog, learn, ai, billing, ops
-- Quy ước: snake_case, khoá chính uuid (gen_random_uuid), timestamptz,
--          i18n JSONB {"vi":..,"en":..,"ja":..,"ko":..,"th":..}, soft-delete bằng deleted_at
-- Bảng khối lượng lớn partition theo tháng: learn.attempt_answers, ai.ai_tasks, ops.audit_logs, ops.outbox
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS learn;
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS ops;

-- Hàm cập nhật updated_at dùng chung
CREATE OR REPLACE FUNCTION ops.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- =============================================================================
-- 1. IAM – người dùng, phiên, vai trò, tổ chức, referral, đồng ý
-- =============================================================================
CREATE TYPE iam.user_status AS ENUM ('active','suspended','pending_deletion','deleted');
CREATE TYPE iam.auth_provider AS ENUM ('email','phone','google','apple','facebook','zalo');
CREATE TYPE iam.org_type AS ENUM ('school','center','company','other');
CREATE TYPE iam.org_role AS ENUM ('org_admin','teacher','learner');
CREATE TYPE iam.referral_status AS ENUM ('joined','started','upgraded');
CREATE TYPE iam.consent_type AS ENUM ('terms','privacy','voice_processing','marketing','minor_guardian');

CREATE TABLE iam.users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext UNIQUE,
  phone           text UNIQUE,
  password_hash   text,
  display_name    text NOT NULL,
  avatar_url      text,
  ui_locale       text NOT NULL DEFAULT 'vi',          -- vi|en|ja|ko|th
  explain_locale  text NOT NULL DEFAULT 'vi',          -- ngôn ngữ giải thích
  timezone        text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  status          iam.user_status NOT NULL DEFAULT 'active',
  is_guest        boolean NOT NULL DEFAULT false,      -- tài khoản khách, ghép khi đăng ký
  birth_year      smallint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  referral_code   text UNIQUE                          -- v1.1 – Sprint 8: mã giới thiệu của người dùng (cấp lười khi GET /me/referral)
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON iam.users FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TABLE iam.auth_identities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  provider      iam.auth_provider NOT NULL,
  provider_uid  text NOT NULL,
  email         citext,
  raw_profile   jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);
CREATE INDEX ix_auth_identities_user ON iam.auth_identities(user_id);

CREATE TABLE iam.sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  device             jsonb,                             -- {platform, model, app_version}
  ip                 inet,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz
);
CREATE INDEX ix_sessions_user_active ON iam.sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE iam.roles (
  code        text PRIMARY KEY,                         -- learner, teacher, editor, admin, superadmin
  description text
);

CREATE TABLE iam.user_roles (
  user_id      uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  role_code    text NOT NULL REFERENCES iam.roles(code),
  program_code text,                                   -- NULL = mọi chương trình (phân quyền giáo viên theo chương trình)
  granted_by   uuid REFERENCES iam.users(id),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (user_id, role_code, program_code)
);

CREATE TABLE iam.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        iam.org_type NOT NULL,
  tax_code    text,
  domain      text,                                     -- SSO domain
  settings    jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.classes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES iam.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  program_code    text,
  teacher_user_id uuid REFERENCES iam.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.org_memberships (
  org_id     uuid NOT NULL REFERENCES iam.organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  role       iam.org_role NOT NULL,
  class_id   uuid REFERENCES iam.classes(id) ON DELETE SET NULL,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX ix_org_memberships_user ON iam.org_memberships(user_id);

CREATE TABLE iam.referrals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id    uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  referee_user_id     uuid UNIQUE REFERENCES iam.users(id) ON DELETE CASCADE,
  code                text NOT NULL,
  status              iam.referral_status NOT NULL DEFAULT 'joined',
  device_fingerprint  text,
  ip                  inet,
  credited_join_at    timestamptz,
  credited_upgrade_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  blocked_reason      text,                             -- v1.1 – Sprint 8: self_referral | duplicate_device | duplicate_ip (không thưởng)
  metadata            jsonb NOT NULL DEFAULT '{}',      -- v1.1 – Sprint 8: utm, lý do bỏ qua thưởng theo mốc, ledger id
  started_at          timestamptz,                      -- v1.1 – Sprint 8: attempt.graded đầu tiên của người được giới thiệu
  upgraded_at         timestamptz                       -- v1.1 – Sprint 8: order.paid gói Pro đầu tiên
);
CREATE INDEX ix_referrals_referrer ON iam.referrals(referrer_user_id);
CREATE INDEX ix_referrals_fingerprint ON iam.referrals(device_fingerprint, created_at) WHERE device_fingerprint IS NOT NULL;  -- v1.1 – Sprint 8: chống lạm dụng
CREATE INDEX ix_referrals_ip ON iam.referrals(ip, created_at) WHERE ip IS NOT NULL;  -- v1.1 – Sprint 8

CREATE TABLE iam.consents (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  type       iam.consent_type NOT NULL,
  version    text NOT NULL,                             -- phiên bản điều khoản/chính sách
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  ip         inet
);
CREATE INDEX ix_consents_user_type ON iam.consents(user_id, type);

CREATE TABLE iam.deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES iam.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz NOT NULL,                    -- requested_at + 72h
  completed_at timestamptz,
  export_url   text
);

-- =============================================================================
-- 2. CATALOG – chương trình, cấu trúc đề, câu hỏi, đề thi, bài học, video, từ vựng
-- =============================================================================
CREATE TYPE catalog.content_status AS ENUM ('draft','ai_checked','review1','review2','published','retired','rejected');
CREATE TYPE catalog.content_source AS ENUM ('human','ai','licensed','user_submitted');
CREATE TYPE catalog.difficulty AS ENUM ('A1','A2','B1','B2','C1','C2','N5','N4','N3','N2','N1','HSK1','HSK2','HSK3','HSK4','HSK5','HSK6','HSK7_9','mixed');
CREATE TYPE catalog.media_kind AS ENUM ('audio','image','video_ref','document');
CREATE TYPE catalog.media_status AS ENUM ('uploading','processing','ready','failed');  -- v1.1 – Sprint 2: pipeline media.process
CREATE TYPE catalog.passage_kind AS ENUM ('reading_passage','audio_script','image_prompt','chart_prompt','dialogue');
CREATE TYPE catalog.test_set_kind AS ENUM ('full','mini','part_drill','diagnostic','topic_pack');
CREATE TYPE catalog.lesson_kind AS ENUM ('lesson','grammar','pronunciation','strategy');
CREATE TYPE catalog.video_category AS ENUM ('mock_speaking','conversation','movie','story','lecture','anime','news','user_link');
CREATE TYPE catalog.vocab_kind AS ENUM ('word','collocation','phrasal_verb','kanji','hanzi','grammar_point');
CREATE TYPE catalog.review_stage AS ENUM ('ai_check','review1','review2');
CREATE TYPE catalog.review_decision AS ENUM ('approve','reject','needs_change');

CREATE TABLE catalog.programs (
  code         text PRIMARY KEY,                        -- toeic | ielts | jlpt | hsk
  name         jsonb NOT NULL,                          -- i18n
  score_scale  jsonb NOT NULL,                          -- {"type":"toeic","min":10,"max":990,...}
  languages    text[] NOT NULL,                         -- ngôn ngữ mục tiêu: {'en'} | {'ja'} | {'zh'}
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   smallint NOT NULL DEFAULT 0
);

CREATE TABLE catalog.skills (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code text NOT NULL REFERENCES catalog.programs(code),
  code         text NOT NULL,                           -- listening|reading|writing|speaking|language_knowledge
  name         jsonb NOT NULL,
  sort_order   smallint NOT NULL DEFAULT 0,
  UNIQUE (program_code, code)
);

CREATE TABLE catalog.sections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code    text NOT NULL REFERENCES catalog.programs(code),
  skill_id        uuid NOT NULL REFERENCES catalog.skills(id),
  code            text NOT NULL,                        -- part1..part7, listening_s1.., writing_task1, speaking_part2 ...
  name            jsonb NOT NULL,
  level           text,                                 -- JLPT N5..N1 / HSK level khi cấu trúc khác theo cấp
  sort_order      smallint NOT NULL DEFAULT 0,
  duration_sec    integer,
  question_count  smallint,
  rules           jsonb NOT NULL DEFAULT '{}',          -- {"audio_once":true,"lock_on_timeout":true}
  UNIQUE NULLS NOT DISTINCT (program_code, code, level)
);

CREATE TABLE catalog.question_types (
  code           text PRIMARY KEY,                      -- mcq_single, mcq_multi, fill_blank, matching, drag_drop, map_label, tfng, ordering, dictation, essay, speaking, handwriting
  name           jsonb NOT NULL,
  content_schema jsonb NOT NULL,                        -- JSON Schema của content (bản Zod ở packages/schemas là nguồn)
  auto_gradable  boolean NOT NULL DEFAULT true
);

CREATE TABLE catalog.topics (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code text REFERENCES catalog.programs(code),  -- NULL = dùng chung
  code         text NOT NULL,
  name         jsonb NOT NULL,
  UNIQUE NULLS NOT DISTINCT (program_code, code)
);

CREATE TABLE catalog.subskills (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code text NOT NULL REFERENCES catalog.programs(code),
  skill_id     uuid NOT NULL REFERENCES catalog.skills(id),
  code         text NOT NULL,                           -- paraphrase_recognition, past_simple, tone3_sandhi ...
  name         jsonb NOT NULL,
  description  jsonb,
  UNIQUE (program_code, code)
);

CREATE TABLE catalog.media_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          catalog.media_kind NOT NULL,
  storage_key   text,                                   -- S3 key (NULL với video_ref)
  external_url  text,
  mime_type     text,
  duration_ms   integer,
  width         integer,
  height        integer,
  size_bytes    bigint,
  license       text NOT NULL DEFAULT 'own',            -- own | cc-by | licensed:<ref>
  transcript    jsonb,                                  -- [{start_ms,end_ms,text,speaker}]
  checksum      text,
  created_by    uuid REFERENCES iam.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- v1.1 – Sprint 2 (migration 0002): trạng thái pipeline media.process + kết quả xử lý
  status        catalog.media_status NOT NULL DEFAULT 'ready',  -- uploading → processing → ready | failed
  metadata      jsonb NOT NULL DEFAULT '{}',            -- {bucket, original, variants, waveform:{peaks[]}, thumbnail_key, error, tts}
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_media_assets_pending ON catalog.media_assets(status) WHERE status IN ('uploading','processing');  -- v1.1 – Sprint 2
CREATE TRIGGER trg_media_assets_updated BEFORE UPDATE ON catalog.media_assets FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();  -- v1.1 – Sprint 2

CREATE TABLE catalog.passages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code   text NOT NULL REFERENCES catalog.programs(code),
  kind           catalog.passage_kind NOT NULL,
  title          text,
  body           text,                                  -- văn bản / script
  media_asset_id uuid REFERENCES catalog.media_assets(id),
  word_count     integer,
  difficulty     catalog.difficulty,
  topic_id       uuid REFERENCES catalog.topics(id),
  source         catalog.content_source NOT NULL DEFAULT 'human',
  status         catalog.content_status NOT NULL DEFAULT 'draft',
  created_by     uuid REFERENCES iam.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_passages_program_status ON catalog.passages(program_code, status);

CREATE TABLE catalog.questions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code       text NOT NULL REFERENCES catalog.programs(code),
  section_id         uuid NOT NULL REFERENCES catalog.sections(id),
  question_type_code text NOT NULL REFERENCES catalog.question_types(code),
  passage_id         uuid REFERENCES catalog.passages(id),
  topic_id           uuid REFERENCES catalog.topics(id),
  current_version_id uuid,                              -- FK thêm sau khi tạo question_versions
  status             catalog.content_status NOT NULL DEFAULT 'draft',
  source             catalog.content_source NOT NULL DEFAULT 'human',
  difficulty_target  catalog.difficulty,
  irt_a              numeric(6,3),                      -- độ phân biệt
  irt_b              numeric(6,3),                      -- độ khó
  irt_c              numeric(6,3),                      -- đoán mò
  irt_fitted_at      timestamptz,
  exposure_count     integer NOT NULL DEFAULT 0,
  correct_count      integer NOT NULL DEFAULT 0,
  avg_time_ms        integer,
  created_by         uuid REFERENCES iam.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  retired_at         timestamptz
);
CREATE INDEX ix_questions_program_section_status ON catalog.questions(program_code, section_id, status);
CREATE INDEX ix_questions_passage ON catalog.questions(passage_id);
CREATE INDEX ix_questions_irt ON catalog.questions(program_code, section_id, irt_b) WHERE status = 'published';
CREATE TRIGGER trg_questions_updated BEFORE UPDATE ON catalog.questions FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TABLE catalog.question_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid NOT NULL REFERENCES catalog.questions(id) ON DELETE CASCADE,
  version_no   integer NOT NULL,
  content      jsonb NOT NULL,                          -- {stem, options[], answer, media_ids[], explanation_seed, i18n...} theo question_type
  metadata     jsonb NOT NULL DEFAULT '{}',             -- {difficulty_estimate, trap_type, keywords[]}
  change_note  text,
  created_by   uuid REFERENCES iam.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, version_no)
);
ALTER TABLE catalog.questions
  ADD CONSTRAINT fk_questions_current_version FOREIGN KEY (current_version_id) REFERENCES catalog.question_versions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE catalog.question_subskills (
  question_id uuid NOT NULL REFERENCES catalog.questions(id) ON DELETE CASCADE,
  subskill_id uuid NOT NULL REFERENCES catalog.subskills(id),
  weight      numeric(4,2) NOT NULL DEFAULT 1,
  PRIMARY KEY (question_id, subskill_id)
);

CREATE TABLE catalog.test_sets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code  text NOT NULL REFERENCES catalog.programs(code),
  code          text NOT NULL,                          -- TOEIC-2026-01, IELTS-A-07 ...
  title         jsonb NOT NULL,
  kind          catalog.test_set_kind NOT NULL,
  level         text,
  is_free       boolean NOT NULL DEFAULT false,
  duration_sec  integer,
  year_tag      smallint,
  status        catalog.content_status NOT NULL DEFAULT 'draft',
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_code, code)
);
CREATE INDEX ix_test_sets_program_kind ON catalog.test_sets(program_code, kind, status);

CREATE TABLE catalog.test_set_sections (
  test_set_id  uuid NOT NULL REFERENCES catalog.test_sets(id) ON DELETE CASCADE,
  section_id   uuid NOT NULL REFERENCES catalog.sections(id),
  sort_order   smallint NOT NULL,
  duration_sec integer,
  PRIMARY KEY (test_set_id, section_id)
);

CREATE TABLE catalog.test_set_items (
  test_set_id  uuid NOT NULL REFERENCES catalog.test_sets(id) ON DELETE CASCADE,
  question_id  uuid NOT NULL REFERENCES catalog.questions(id),
  section_id   uuid NOT NULL REFERENCES catalog.sections(id),
  sort_order   smallint NOT NULL,
  group_key    text,                                    -- nhóm câu cùng passage/audio
  points       numeric(5,2) NOT NULL DEFAULT 1,
  PRIMARY KEY (test_set_id, question_id)
);
CREATE INDEX ix_test_set_items_order ON catalog.test_set_items(test_set_id, section_id, sort_order);

CREATE TABLE catalog.grammar_topics (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code text NOT NULL REFERENCES catalog.programs(code),
  code         text NOT NULL,
  name         jsonb NOT NULL,
  level        text,
  sort_order   smallint NOT NULL DEFAULT 0,
  UNIQUE (program_code, code)
);

CREATE TABLE catalog.lessons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code     text NOT NULL REFERENCES catalog.programs(code),
  skill_id         uuid REFERENCES catalog.skills(id),
  section_id       uuid REFERENCES catalog.sections(id),
  grammar_topic_id uuid REFERENCES catalog.grammar_topics(id),
  kind             catalog.lesson_kind NOT NULL,
  level            text,
  title            jsonb NOT NULL,
  summary          jsonb,
  est_minutes      smallint,
  is_free          boolean NOT NULL DEFAULT false,
  sort_order       smallint NOT NULL DEFAULT 0,
  status           catalog.content_status NOT NULL DEFAULT 'draft',
  source           catalog.content_source NOT NULL DEFAULT 'human',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_lessons_program_kind ON catalog.lessons(program_code, kind, status);

CREATE TABLE catalog.lesson_steps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id  uuid NOT NULL REFERENCES catalog.lessons(id) ON DELETE CASCADE,
  sort_order smallint NOT NULL,
  step_type  text NOT NULL,                             -- teach | check | drill | practice | ai_grade
  content    jsonb NOT NULL,                            -- i18n body, câu hỏi kiểm tra, tham chiếu exercise/question
  UNIQUE (lesson_id, sort_order)
);

CREATE TABLE catalog.exercises (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code     text NOT NULL REFERENCES catalog.programs(code),
  lesson_id        uuid REFERENCES catalog.lessons(id) ON DELETE CASCADE,
  grammar_topic_id uuid REFERENCES catalog.grammar_topics(id),
  exercise_type    text NOT NULL,                       -- choose_from_box, reorder, match_halves, gap_paragraph, mcq, write_sentence
  content          jsonb NOT NULL,
  answer           jsonb NOT NULL,
  difficulty       catalog.difficulty,
  status           catalog.content_status NOT NULL DEFAULT 'draft',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_exercises_lesson ON catalog.exercises(lesson_id);
CREATE INDEX ix_exercises_grammar ON catalog.exercises(grammar_topic_id);

CREATE TABLE catalog.videos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code  text NOT NULL REFERENCES catalog.programs(code),
  youtube_id    text NOT NULL,
  title         text NOT NULL,
  channel       text,
  duration_sec  integer,
  language      text NOT NULL,                          -- en | ja | zh
  category      catalog.video_category NOT NULL,
  level         text,
  status        catalog.content_status NOT NULL DEFAULT 'draft',
  submitted_by  uuid REFERENCES iam.users(id),          -- link người dùng dán
  segment_job   jsonb,                                  -- trạng thái tách câu
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_code, youtube_id)
);
CREATE INDEX ix_videos_program_category ON catalog.videos(program_code, category, status);

CREATE TABLE catalog.video_sentences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id     uuid NOT NULL REFERENCES catalog.videos(id) ON DELETE CASCADE,
  sort_order   integer NOT NULL,
  start_ms     integer NOT NULL,
  end_ms       integer NOT NULL,
  text         text NOT NULL,
  ipa          text,
  reading      text,                                    -- furigana / pinyin
  translations jsonb NOT NULL DEFAULT '{}',             -- {"vi":"...","en":"..."} dùng chung
  UNIQUE (video_id, sort_order)
);

CREATE TABLE catalog.vocab_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code    text NOT NULL REFERENCES catalog.programs(code),
  kind            catalog.vocab_kind NOT NULL DEFAULT 'word',
  headword        text NOT NULL,
  reading         text,                                 -- furigana / pinyin
  sino_vietnamese text,                                 -- âm Hán Việt
  pos             text,
  ipa_uk          text,
  ipa_us          text,
  audio_uk_id     uuid REFERENCES catalog.media_assets(id),
  audio_us_id     uuid REFERENCES catalog.media_assets(id),
  meanings        jsonb NOT NULL,                       -- {"en":[..],"vi":[..],...}
  examples        jsonb NOT NULL DEFAULT '[]',          -- [{text, translation, audio_id}]
  collocations    jsonb NOT NULL DEFAULT '[]',
  radicals        text[],                               -- bộ thủ (kanji/hanzi)
  stroke_count    smallint,
  level           text,                                 -- CEFR / N-level / HSK level
  frequency_rank  integer,
  source          catalog.content_source NOT NULL DEFAULT 'human',
  status          catalog.content_status NOT NULL DEFAULT 'published',
  created_at      timestamptz NOT NULL DEFAULT now(),
  forms           text[] NOT NULL DEFAULT '{}',         -- v1.1 – Sprint 6: headword + dạng biến đổi đã chuẩn hoá (tra ngược invoices → invoice)
  topics          text[] NOT NULL DEFAULT '{}'          -- v1.1 – Sprint 6: chủ đề (office, finance…) từ dữ liệu từ điển
);
CREATE INDEX ix_vocab_items_program_headword ON catalog.vocab_items(program_code, headword);
CREATE INDEX ix_vocab_items_headword_trgm ON catalog.vocab_items USING gin (headword gin_trgm_ops);
CREATE INDEX ix_vocab_items_forms ON catalog.vocab_items USING gin (forms);   -- v1.1 – Sprint 6: GET /dictionary/lookup theo dạng từ

CREATE TABLE catalog.vocab_lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code  text NOT NULL REFERENCES catalog.programs(code),
  kind          text NOT NULL,                          -- core | test_set | collocation | phrasal | topic | kanji | custom
  title         jsonb NOT NULL,
  test_set_id   uuid REFERENCES catalog.test_sets(id),
  topic_id      uuid REFERENCES catalog.topics(id),
  owner_user_id uuid REFERENCES iam.users(id),          -- NULL = hệ thống
  is_free       boolean NOT NULL DEFAULT false,
  sort_order    smallint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_vocab_lists_owner ON catalog.vocab_lists(owner_user_id);

CREATE TABLE catalog.vocab_list_items (
  list_id       uuid NOT NULL REFERENCES catalog.vocab_lists(id) ON DELETE CASCADE,
  vocab_item_id uuid NOT NULL REFERENCES catalog.vocab_items(id),
  sort_order    integer NOT NULL,
  PRIMARY KEY (list_id, vocab_item_id)
);

CREATE TABLE catalog.content_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL,                           -- question | passage | lesson | exercise | video | vocab_item
  entity_id    uuid NOT NULL,
  stage        catalog.review_stage NOT NULL,
  reviewer_id  uuid REFERENCES iam.users(id),           -- NULL khi AI
  decision     catalog.review_decision NOT NULL,
  notes        text,
  ai_report    jsonb,                                   -- {unique_answer, grammar_issues[], duplicate_of, difficulty_estimate}
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_content_reviews_entity ON catalog.content_reviews(entity_type, entity_id, created_at DESC);

-- =============================================================================
-- 3. LEARN – enrollment, lộ trình, bài làm, chấm, SRS, tiến độ, nhật ký lỗi
-- =============================================================================
CREATE TYPE learn.attempt_mode AS ENUM ('exam','practice','diagnostic','drill','timed_drill');
CREATE TYPE learn.attempt_status AS ENUM ('in_progress','submitted','graded','abandoned');
CREATE TYPE learn.submission_kind AS ENUM ('writing','speaking','impromptu','shadowing_sentence','pronunciation','grammar_sentence','handwriting');
CREATE TYPE learn.submission_status AS ENUM ('queued','processing','graded','failed','cancelled');
CREATE TYPE learn.plan_task_type AS ENUM ('full_test','part_drill','timed_drill','lesson','grammar','vocab_review','shadowing','dictation','writing','speaking','impromptu','checkin','review_errors');
CREATE TYPE learn.plan_task_status AS ENUM ('pending','done','skipped','expired');
CREATE TYPE learn.error_kind AS ENUM ('paraphrase','trap','vocabulary','timeout','grammar','listening_detail','inference','spelling','tone','pronunciation','other');
CREATE TYPE learn.srs_state AS ENUM ('new','learning','review','relearning');
CREATE TYPE learn.srs_card_type AS ENUM ('vocab','error','grammar','phoneme','sentence');

CREATE TABLE learn.enrollments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  program_code   text NOT NULL REFERENCES catalog.programs(code),
  target_score   numeric(6,2),
  target_level   text,                                  -- N2, HSK5, band 7.0 ...
  exam_date      date,
  daily_minutes  smallint NOT NULL DEFAULT 30,
  current_level  jsonb,                                 -- {"overall":6.0,"listening":6.5,...} ước tính
  is_active      boolean NOT NULL DEFAULT true,
  started_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, program_code)
);
CREATE TRIGGER trg_enrollments_updated BEFORE UPDATE ON learn.enrollments FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TABLE learn.study_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES learn.enrollments(id) ON DELETE CASCADE,
  version_no    integer NOT NULL,
  strategy      jsonb NOT NULL,                         -- {weeks, focus_rotation, minutes_per_skill, mastery_path}
  generated_by  text NOT NULL,                          -- rule | ai | manual
  is_current    boolean NOT NULL DEFAULT true,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, version_no)
);
CREATE INDEX ix_study_plans_current ON learn.study_plans(enrollment_id) WHERE is_current;

CREATE TABLE learn.plan_weeks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id           uuid NOT NULL REFERENCES learn.study_plans(id) ON DELETE CASCADE,
  week_no           smallint NOT NULL,
  start_date        date NOT NULL,
  focus_skill_id    uuid REFERENCES catalog.skills(id),
  focus_section_id  uuid REFERENCES catalog.sections(id),
  load_minutes      smallint,
  checkin_done_at   timestamptz,
  adjustment        jsonb,                              -- {reason, evidence:"sai 9/12 câu dạng từ", changes[]}
  UNIQUE (plan_id, week_no)
);

CREATE TABLE learn.plan_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_week_id  uuid NOT NULL REFERENCES learn.plan_weeks(id) ON DELETE CASCADE,
  due_date      date NOT NULL,
  task_type     learn.plan_task_type NOT NULL,
  ref_type      text,                                   -- test_set | section | lesson | video | vocab_list | prompt
  ref_id        uuid,
  title         jsonb,
  est_minutes   smallint,
  status        learn.plan_task_status NOT NULL DEFAULT 'pending',
  evidence      jsonb,                                  -- lý do giao bài
  completed_at  timestamptz,
  result_ref    jsonb                                   -- {attempt_id | submission_id}
);
CREATE INDEX ix_plan_tasks_week_due ON learn.plan_tasks(plan_week_id, due_date);
CREATE INDEX ix_plan_tasks_pending_due ON learn.plan_tasks(due_date) WHERE status = 'pending';  -- v1.1 – Sprint 9: job plan.expire_tasks (3 ngày)

-- v1.1 – Sprint 9 (migration 0006): lịch sử đề xuất điều chỉnh lộ trình (plan_adjust) – check-in tuần / câu lệnh tự nhiên
CREATE TABLE learn.plan_adjustments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid NOT NULL REFERENCES learn.study_plans(id) ON DELETE CASCADE,
  plan_week_id  uuid REFERENCES learn.plan_weeks(id) ON DELETE CASCADE,   -- tuần đích (check-in: tuần tới)
  user_id       uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  source        text NOT NULL,                          -- checkin | instruction
  status        text NOT NULL DEFAULT 'pending',        -- pending | ready | rejected | needs_clarification | applied | expired | failed | superseded
  input         jsonb NOT NULL DEFAULT '{}',            -- {feeling, actual_minutes, difficulties (đã che PII), availability_next_week} | {instruction}
  proposal      jsonb,                                  -- đầu ra plan_adjust đã validate Zod {summary, operations[], needs_clarification, clarifying_question}
  result        jsonb,                                  -- server tính: {before[], after[], changes[], violations[], minutes_before/after, budget, max_minutes}
  ai_task_id    uuid,                                   -- loose ref ai.ai_tasks (partition)
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  applied_at    timestamptz,
  CONSTRAINT plan_adjustments_source_check CHECK (source IN ('checkin','instruction')),
  CONSTRAINT plan_adjustments_status_check CHECK (status IN ('pending','ready','rejected','needs_clarification','applied','expired','failed','superseded'))
);
CREATE INDEX ix_plan_adjustments_user ON learn.plan_adjustments(user_id, created_at DESC);
CREATE INDEX ix_plan_adjustments_plan ON learn.plan_adjustments(plan_id, created_at DESC);

CREATE TABLE learn.skill_mastery (
  user_id      uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  program_code text NOT NULL REFERENCES catalog.programs(code),
  subskill_id  uuid NOT NULL REFERENCES catalog.subskills(id),
  mastery      numeric(5,4) NOT NULL DEFAULT 0,         -- 0..1 (knowledge tracing)
  confidence   numeric(5,4),
  n_obs        integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subskill_id)
);

CREATE TABLE learn.attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  program_code    text NOT NULL REFERENCES catalog.programs(code),
  test_set_id     uuid REFERENCES catalog.test_sets(id),
  section_id      uuid REFERENCES catalog.sections(id),  -- khi luyện 1 Part
  mode            learn.attempt_mode NOT NULL,
  status          learn.attempt_status NOT NULL DEFAULT 'in_progress',
  started_at      timestamptz NOT NULL DEFAULT now(),
  submitted_at    timestamptz,
  time_spent_sec  integer,
  raw_score       numeric(7,2),
  scaled_score    numeric(7,2),                          -- điểm ước tính theo thang chương trình
  score_breakdown jsonb,                                 -- {by_section:{}, by_type:{}, by_subskill:{}}
  draft_state     jsonb,                                 -- lưu nháp tự động
  device          jsonb,
  tab_leave_count smallint NOT NULL DEFAULT 0,
  plan_task_id    uuid REFERENCES learn.plan_tasks(id)
);
CREATE INDEX ix_attempts_user_started ON learn.attempts(user_id, started_at DESC);
CREATE INDEX ix_attempts_test_set ON learn.attempts(test_set_id);
CREATE INDEX ix_attempts_in_progress ON learn.attempts(user_id) WHERE status = 'in_progress';

-- attempt_answers: partition theo tháng (created_at) – khối lượng lớn nhất
CREATE TABLE learn.attempt_answers (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  attempt_id          uuid NOT NULL REFERENCES learn.attempts(id) ON DELETE CASCADE,
  question_id         uuid NOT NULL REFERENCES catalog.questions(id),
  question_version_id uuid NOT NULL REFERENCES catalog.question_versions(id),
  answer              jsonb,
  is_correct          boolean,
  score               numeric(5,2),
  time_spent_ms       integer,
  flagged             boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX ix_attempt_answers_attempt ON learn.attempt_answers(attempt_id);
CREATE INDEX ix_attempt_answers_question ON learn.attempt_answers(question_id, created_at);

CREATE TABLE learn.recordings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  storage_key    text NOT NULL,
  mime_type      text NOT NULL,
  duration_ms    integer,
  size_bytes     integer,
  transcript     jsonb,                                 -- [{start_ms,end_ms,text,confidence}]
  stt_confidence numeric(4,3),
  expires_at     timestamptz,                           -- vòng đời theo gói (90/365 ngày)
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_recordings_expiry ON learn.recordings(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE learn.submissions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  program_code         text NOT NULL REFERENCES catalog.programs(code),
  kind                 learn.submission_kind NOT NULL,
  prompt_ref_type      text NOT NULL,                   -- question | video_sentence | exercise | impromptu_prompt | lesson_step
  prompt_ref_id        uuid,
  attempt_id           uuid REFERENCES learn.attempts(id),
  parent_submission_id uuid REFERENCES learn.submissions(id),  -- làm lại
  text_body            text,
  recording_id         uuid REFERENCES learn.recordings(id),
  attachment_id        uuid REFERENCES catalog.media_assets(id),  -- ảnh biểu đồ Task 1 / bài viết tay
  word_count           integer,
  duration_ms          integer,
  status               learn.submission_status NOT NULL DEFAULT 'queued',
  job_id               text,
  error                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  graded_at            timestamptz
);
CREATE INDEX ix_submissions_user_created ON learn.submissions(user_id, created_at DESC);
CREATE INDEX ix_submissions_status ON learn.submissions(status) WHERE status IN ('queued','processing');

CREATE TABLE learn.grading_results (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id     uuid NOT NULL UNIQUE REFERENCES learn.submissions(id) ON DELETE CASCADE,
  rubric_code       text NOT NULL,                      -- ielts_writing_t2 | toeic_speaking_q11 | ...
  overall_score     numeric(6,2),
  criterion_scores  jsonb NOT NULL,                     -- {"task_response":6.5,"coherence":6.0,...}
  feedback          jsonb NOT NULL,                     -- i18n, theo tiêu chí, "sửa gì trước"
  errors            jsonb NOT NULL DEFAULT '[]',        -- [{span:[s,e], type, explanation, suggestion, grammar_topic_id}]
  model_answer      text,
  model_answer_meta jsonb,                              -- cụm tô sáng, connectors
  confidence        text NOT NULL DEFAULT 'normal',     -- low | normal | high
  prompt_version_id uuid,                               -- ai.prompt_versions
  ai_task_id        uuid,                               -- ai.ai_tasks (loose ref: bảng partition)
  graded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learn.pronunciation_scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES learn.submissions(id) ON DELETE CASCADE,
  accuracy      numeric(5,2),
  fluency       numeric(5,2),
  prosody       numeric(5,2),
  completeness  numeric(5,2),
  overall       numeric(5,2),
  words         jsonb NOT NULL DEFAULT '[]',            -- [{word, score, phonemes:[{p, score}], error_type}]
  tones         jsonb,                                  -- [{syllable, expected, detected, score}]
  pitch_contour jsonb,                                  -- [[t_ms, hz]] người học & mẫu
  provider      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learn.phrasing_fixes (                      -- Upgrade your phrasing
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grading_result_id  uuid NOT NULL REFERENCES learn.grading_results(id) ON DELETE CASCADE,
  error_index        smallint NOT NULL,
  user_rewrite       text,
  verdict            text,                               -- fixed | partly | not_yet
  ai_note            text,
  carried_over       boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learn.error_log_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  program_code      text NOT NULL REFERENCES catalog.programs(code),
  attempt_answer_id uuid,                                -- loose ref (bảng partition)
  submission_id     uuid REFERENCES learn.submissions(id) ON DELETE CASCADE,
  question_id       uuid REFERENCES catalog.questions(id),
  subskill_id       uuid REFERENCES catalog.subskills(id),
  error_kind        learn.error_kind NOT NULL,
  reason_auto       jsonb,                               -- {kind, evidence:{paraphrase_pairs[]...}}
  reason_override   learn.error_kind,                    -- người học đổi
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_error_log_user_recent ON learn.error_log_entries(user_id, program_code, created_at DESC);

CREATE TABLE learn.srs_cards (                           -- FSRS cho từ vựng, lỗi, ngữ pháp, âm, câu
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  program_code  text NOT NULL REFERENCES catalog.programs(code),
  card_type     learn.srs_card_type NOT NULL,
  ref_id        uuid NOT NULL,                          -- vocab_item_id | error_log_entry_id | grammar_topic_id | ...
  source_type   text,                                   -- test_set | feedback | manual | lesson
  source_id     uuid,
  state         learn.srs_state NOT NULL DEFAULT 'new',
  stability     real,
  difficulty    real,
  due_at        timestamptz NOT NULL DEFAULT now(),
  last_review_at timestamptz,
  reps          integer NOT NULL DEFAULT 0,
  lapses        integer NOT NULL DEFAULT 0,
  suspended     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, card_type, ref_id)
);
CREATE INDEX ix_srs_cards_due ON learn.srs_cards(user_id, program_code, due_at) WHERE NOT suspended;

CREATE TABLE learn.srs_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id        uuid NOT NULL REFERENCES learn.srs_cards(id) ON DELETE CASCADE,
  rating         smallint NOT NULL,                     -- 1 again · 2 hard · 3 good · 4 easy
  review_mode    text,                                  -- flashcard | gap_fill | listen_type | match | use_in_sentence
  elapsed_days   real,
  scheduled_days real,
  reviewed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_srs_reviews_card ON learn.srs_reviews(card_id, reviewed_at DESC);

CREATE TABLE learn.notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  test_set_id uuid REFERENCES catalog.test_sets(id) ON DELETE CASCADE,
  question_id uuid REFERENCES catalog.questions(id) ON DELETE CASCADE,
  body        text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL DEFAULT 'user',            -- v1.1 – Sprint 5: user | system_summary (summarize_attempt)
  data        jsonb,                                   -- v1.1 – Sprint 5: thẻ tóm tắt {attempt_id, attempt_ids, summary, ai_task_id, prompt_version_id}
  CONSTRAINT notes_kind_check CHECK (kind IN ('user','system_summary'))
);
CREATE INDEX ix_notes_user_test ON learn.notes(user_id, test_set_id);
CREATE INDEX ix_notes_user_kind ON learn.notes(user_id, kind, updated_at DESC);
CREATE UNIQUE INDEX ux_notes_system_summary ON learn.notes(user_id, (data->>'attempt_id')) WHERE kind = 'system_summary';

CREATE TABLE learn.lesson_progress (
  user_id         uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  lesson_id       uuid NOT NULL REFERENCES catalog.lessons(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'in_progress',  -- in_progress | completed
  current_step    smallint NOT NULL DEFAULT 1,
  score           numeric(5,2),
  chat_thread_id  uuid,                                 -- hội thoại trong bài
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE learn.shadowing_progress (
  user_id        uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  video_id       uuid NOT NULL REFERENCES catalog.videos(id) ON DELETE CASCADE,
  sentences_done integer NOT NULL DEFAULT 0,
  best_scores    jsonb NOT NULL DEFAULT '{}',           -- {sentence_id: score}
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);

CREATE TABLE learn.streaks (
  user_id          uuid PRIMARY KEY REFERENCES iam.users(id) ON DELETE CASCADE,
  current_streak   integer NOT NULL DEFAULT 0,
  longest_streak   integer NOT NULL DEFAULT 0,
  last_active_date date,
  freeze_available_at date,
  freezes_used     integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learn.xp_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  kind       text NOT NULL,                             -- practice | test | lesson | vocab | shadowing | checkin
  amount     integer NOT NULL,
  ref_type   text,
  ref_id     uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_xp_events_user_date ON learn.xp_events(user_id, created_at DESC);

CREATE TABLE learn.badges (
  code  text PRIMARY KEY,
  name  jsonb NOT NULL,
  rule  jsonb NOT NULL
);
CREATE TABLE learn.user_badges (
  user_id    uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  badge_code text NOT NULL REFERENCES learn.badges(code),
  earned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_code)
);

CREATE TABLE learn.score_forecasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id   uuid NOT NULL REFERENCES learn.enrollments(id) ON DELETE CASCADE,
  predicted_score numeric(6,2) NOT NULL,
  ci_low          numeric(6,2),
  ci_high         numeric(6,2),
  ready_date      date,
  model_version   text NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_score_forecasts_enrollment ON learn.score_forecasts(enrollment_id, computed_at DESC);

CREATE TABLE learn.chat_threads (                        -- gia sư AI
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  program_code text REFERENCES catalog.programs(code),
  context     jsonb,                                    -- {attempt_id, submission_id, lesson_id, mode:"text|voice|realtime"}
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_chat_threads_user ON learn.chat_threads(user_id, updated_at DESC);

CREATE TABLE learn.chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid NOT NULL REFERENCES learn.chat_threads(id) ON DELETE CASCADE,
  role        text NOT NULL,                            -- user | assistant | system | tool
  content     jsonb NOT NULL,                           -- {text, audio_id, actions[]}
  ai_task_id  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_chat_messages_thread ON learn.chat_messages(thread_id, created_at);

-- B2B: bài giao trong lớp
CREATE TABLE learn.assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES iam.organizations(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL REFERENCES iam.classes(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES iam.users(id),
  title       text NOT NULL,
  task_type   learn.plan_task_type NOT NULL,
  ref_type    text,
  ref_id      uuid,
  due_at      timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE learn.assignment_submissions (
  assignment_id uuid NOT NULL REFERENCES learn.assignments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  result_ref    jsonb,
  completed_at  timestamptz,
  PRIMARY KEY (assignment_id, user_id)
);

-- =============================================================================
-- 4. AI – prompt registry, định tuyến, task, cache, eval, embedding
-- =============================================================================
CREATE TYPE ai.prompt_status AS ENUM ('draft','canary','active','retired');
CREATE TYPE ai.task_status AS ENUM ('queued','running','succeeded','failed','timeout','refused');

CREATE TABLE ai.prompt_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL,                           -- explain_mcq, tutor_chat, grade_writing, grade_speaking, generate_questions, segment_video ...
  program_code text REFERENCES catalog.programs(code),  -- NULL = dùng chung
  description  text,
  UNIQUE NULLS NOT DISTINCT (code, program_code)
);

CREATE TABLE ai.prompt_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    uuid NOT NULL REFERENCES ai.prompt_templates(id) ON DELETE CASCADE,
  version_no     integer NOT NULL,
  system_prompt  text NOT NULL,
  user_template  text NOT NULL,                         -- mustache/handlebars
  few_shots      jsonb NOT NULL DEFAULT '[]',
  rubric         jsonb,                                 -- tiêu chí, band descriptors
  output_schema  jsonb NOT NULL,                        -- JSON Schema structured output
  model_policy   jsonb NOT NULL,                        -- {primary, fallbacks[], temperature, max_tokens}
  status         ai.prompt_status NOT NULL DEFAULT 'draft',
  canary_percent smallint NOT NULL DEFAULT 0,
  eval_run_id    uuid,
  created_by     uuid REFERENCES iam.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_no)
);
CREATE INDEX ix_prompt_versions_active ON ai.prompt_versions(template_id) WHERE status IN ('active','canary');

CREATE TABLE ai.model_routes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_code       text NOT NULL UNIQUE,                 -- explain | chat | grade_writing | grade_speaking | stt | pa | tts | realtime | generate | vision | embed
  primary_model   text NOT NULL,                        -- "google:gemini-flash" | "anthropic:claude-sonnet" | "azure-speech:pa" ...
  fallback_models text[] NOT NULL DEFAULT '{}',
  params          jsonb NOT NULL DEFAULT '{}',
  timeout_ms      integer NOT NULL DEFAULT 30000,
  max_cost_usd    numeric(8,4),
  credits_cost    integer NOT NULL DEFAULT 0,           -- credit trừ mặc định (bảng mục 4 PRD)
  is_active       boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ai_tasks: partition theo tháng
CREATE TABLE ai.ai_tasks (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id           uuid,                               -- loose ref, cho phép NULL (job hệ thống)
  task_code         text NOT NULL,
  prompt_version_id uuid REFERENCES ai.prompt_versions(id),
  model_used        text,
  provider          text,
  status            ai.task_status NOT NULL DEFAULT 'queued',
  input_ref         jsonb,                              -- {submission_id | question_version_id | thread_id ...}
  input_hash        text,
  output            jsonb,
  tokens_in         integer,
  tokens_out        integer,
  audio_seconds     numeric(8,2),
  cost_usd          numeric(10,6),
  credits_charged   integer NOT NULL DEFAULT 0,
  latency_ms        integer,
  trace_id          text,                               -- Langfuse
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  cache_hit         boolean NOT NULL DEFAULT false,     -- v1.1 – Sprint 5: trúng cache (không gọi model)
  fallback_used     boolean NOT NULL DEFAULT false,     -- v1.1 – Sprint 5: model trả lời khác primary của route
  error_code        text,                               -- v1.1 – Sprint 5: provider_error | invalid_output | timeout | not_configured | refused
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX ix_ai_tasks_user_created ON ai.ai_tasks(user_id, created_at DESC);
CREATE INDEX ix_ai_tasks_task_created ON ai.ai_tasks(task_code, created_at);
CREATE INDEX ix_ai_tasks_trace ON ai.ai_tasks(trace_id);

CREATE TABLE ai.explanation_cache (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_version_id uuid NOT NULL REFERENCES catalog.question_versions(id) ON DELETE CASCADE,
  chosen_option       text NOT NULL,                    -- '*' = giải thích chung
  locale              text NOT NULL,
  content             jsonb NOT NULL,
  prompt_version_id   uuid REFERENCES ai.prompt_versions(id),
  hit_count           integer NOT NULL DEFAULT 0,
  quality_score       numeric(3,2),                     -- từ phản hồi người học
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_version_id, chosen_option, locale)
);
CREATE INDEX ix_explanation_cache_prompt ON ai.explanation_cache(prompt_version_id);   -- v1.1 – Sprint 5: invalidation theo phiên bản prompt

CREATE TABLE ai.translation_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash text NOT NULL,
  source_lang text NOT NULL,
  target_lang text NOT NULL,
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_hash, source_lang, target_lang)
);

CREATE TABLE ai.tts_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text_hash   text NOT NULL,
  voice       text NOT NULL,
  storage_key text NOT NULL,
  duration_ms integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (text_hash, voice)
);

CREATE TABLE ai.eval_sets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_code    text NOT NULL,
  program_code text REFERENCES catalog.programs(code),
  name         text NOT NULL,
  description  text,
  thresholds   jsonb NOT NULL,                          -- {"max_band_diff":0.5,"min_within_pct":0.8,"min_corr":0.8}
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai.eval_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_set_id uuid NOT NULL REFERENCES ai.eval_sets(id) ON DELETE CASCADE,
  input       jsonb NOT NULL,                           -- bài viết / đường dẫn ghi âm / câu hỏi
  gold        jsonb NOT NULL,                           -- điểm trung bình 2 giáo viên
  notes       text
);
CREATE TABLE ai.eval_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_set_id       uuid NOT NULL REFERENCES ai.eval_sets(id),
  prompt_version_id uuid NOT NULL REFERENCES ai.prompt_versions(id),
  model             text NOT NULL,
  metrics           jsonb NOT NULL,                     -- {mae, within_0_5_pct, corr, cost_usd, latency_p95}
  passed            boolean NOT NULL,
  run_at            timestamptz NOT NULL DEFAULT now(),
  triggered_by      text                                -- ci | manual | schedule
);
CREATE INDEX ix_eval_runs_version ON ai.eval_runs(prompt_version_id, run_at DESC);  -- v1.1 – Sprint 5: cổng kích hoạt prompt
CREATE TABLE ai.eval_run_items (
  run_id       uuid NOT NULL REFERENCES ai.eval_runs(id) ON DELETE CASCADE,
  eval_item_id uuid NOT NULL REFERENCES ai.eval_items(id),
  output       jsonb NOT NULL,
  diff         numeric(6,3),
  PRIMARY KEY (run_id, eval_item_id)
);

CREATE TABLE ai.feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  ai_task_id uuid NOT NULL,                             -- loose ref
  rating     text NOT NULL,                             -- helpful | not_helpful | wrong
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai.embeddings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,                            -- question_version | passage | model_answer | vocab_item
  entity_id   uuid NOT NULL,
  model       text NOT NULL,
  embedding   vector(1536) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, model)
);
CREATE INDEX ix_embeddings_hnsw ON ai.embeddings USING hnsw (embedding vector_cosine_ops);

-- =============================================================================
-- 5. BILLING – gói, giá, đơn hàng, thanh toán, subscription, entitlement, credit, hoá đơn
-- =============================================================================
CREATE TYPE billing.plan_kind AS ENUM ('free','monthly','yearly','lifetime','combo','credit_pack','b2b_seat');
CREATE TYPE billing.order_status AS ENUM ('pending','paid','failed','cancelled','refunded','expired');
CREATE TYPE billing.payment_provider AS ENUM ('vnpay','momo','zalopay','payos','stripe','bank_transfer','manual');
CREATE TYPE billing.subscription_status AS ENUM ('trialing','active','past_due','cancelled','expired','lifetime');
CREATE TYPE billing.credit_reason AS ENUM ('purchase','subscription_grant','referral','promo','consume','refund','expire','admin_adjust','b2b_pool');
CREATE TYPE billing.quota_period AS ENUM ('day','month','lifetime');

CREATE TABLE billing.plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,                -- toeic_pro_monthly, ielts_pro_lifetime, combo_4, credits_5000 ...
  kind             billing.plan_kind NOT NULL,
  program_codes    text[] NOT NULL DEFAULT '{}',        -- rỗng = credit pack / free
  name             jsonb NOT NULL,
  description      jsonb,
  credits_included integer NOT NULL DEFAULT 0,
  credits_period   text,                                -- monthly | once
  duration_days    integer,                             -- NULL = trọn đời
  features         jsonb NOT NULL DEFAULT '{}',         -- entitlement flags
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       smallint NOT NULL DEFAULT 0
);

CREATE TABLE billing.prices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id    uuid NOT NULL REFERENCES billing.plans(id) ON DELETE CASCADE,
  currency   char(3) NOT NULL DEFAULT 'VND',
  amount     numeric(14,2) NOT NULL,
  compare_at numeric(14,2),                             -- giá gạch
  region     text NOT NULL DEFAULT 'VN',
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to   timestamptz
);
CREATE INDEX ix_prices_plan_valid ON billing.prices(plan_id, valid_from, valid_to);

CREATE TABLE billing.promotions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  kind            text NOT NULL,                        -- v1.1 – Sprint 8: percent | fixed | credit_bonus | trial_days (amount cũ → fixed)
  value           numeric(14,2) NOT NULL,
  plan_ids        uuid[],
  valid_from      timestamptz NOT NULL,
  valid_to        timestamptz NOT NULL,
  max_uses        integer,
  used_count      integer NOT NULL DEFAULT 0,
  per_user_limit  smallint NOT NULL DEFAULT 1,
  is_active       boolean NOT NULL DEFAULT true,
  conditions      jsonb NOT NULL DEFAULT '{}',          -- v1.1 – Sprint 8: {program_codes[], plan_kinds[], new_users_only, new_user_max_days, min_subtotal, trial_plan_code, credit_valid_days}
  stackable       boolean NOT NULL DEFAULT false,       -- v1.1 – Sprint 8: luôn false (một mã/đơn, không cộng dồn)
  name            jsonb,                                -- v1.1 – Sprint 8: tên chiến dịch {vi,en}
  created_at      timestamptz NOT NULL DEFAULT now(),   -- v1.1 – Sprint 8
  updated_at      timestamptz NOT NULL DEFAULT now(),   -- v1.1 – Sprint 8
  CONSTRAINT promotions_kind_check CHECK (kind IN ('percent','fixed','credit_bonus','trial_days'))
);
CREATE TRIGGER trg_promotions_updated BEFORE UPDATE ON billing.promotions FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();  -- v1.1 – Sprint 8

CREATE TABLE billing.orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES iam.users(id),
  org_id          uuid REFERENCES iam.organizations(id),
  plan_id         uuid NOT NULL REFERENCES billing.plans(id),
  price_id        uuid NOT NULL REFERENCES billing.prices(id),
  promotion_id    uuid REFERENCES billing.promotions(id),
  quantity        integer NOT NULL DEFAULT 1,           -- seat B2B
  currency        char(3) NOT NULL,
  subtotal        numeric(14,2) NOT NULL,
  discount        numeric(14,2) NOT NULL DEFAULT 0,
  total           numeric(14,2) NOT NULL,
  status          billing.order_status NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL UNIQUE,
  buyer_info      jsonb,                                -- {name, email, tax_code, address} cho hoá đơn
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz,
  expires_at      timestamptz
);
CREATE INDEX ix_orders_user_created ON billing.orders(user_id, created_at DESC);

CREATE TABLE billing.payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES billing.orders(id),
  provider         billing.payment_provider NOT NULL,
  provider_txn_id  text,
  amount           numeric(14,2) NOT NULL,
  currency         char(3) NOT NULL,
  status           text NOT NULL,                       -- initiated | success | failed | refunded
  raw_callback     jsonb,
  signature_valid  boolean,
  created_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at     timestamptz,
  UNIQUE (provider, provider_txn_id)
);
CREATE INDEX ix_payments_order ON billing.payments(order_id);

CREATE TABLE billing.subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid REFERENCES iam.users(id) ON DELETE CASCADE,
  org_id               uuid REFERENCES iam.organizations(id) ON DELETE CASCADE,
  plan_id              uuid NOT NULL REFERENCES billing.plans(id),
  program_code         text REFERENCES catalog.programs(code),
  status               billing.subscription_status NOT NULL,
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz,                     -- NULL = trọn đời
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  provider_token_ref   text,                            -- token gia hạn tự động (nếu cổng hỗ trợ)
  source_order_id      uuid REFERENCES billing.orders(id),
  seats                integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR org_id IS NOT NULL)
);
CREATE INDEX ix_subscriptions_user_status ON billing.subscriptions(user_id, status);
CREATE INDEX ix_subscriptions_period_end ON billing.subscriptions(current_period_end) WHERE status = 'active';

CREATE TABLE billing.entitlements (                      -- vật chất hoá quyền (ADR-10)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  program_code  text REFERENCES catalog.programs(code), -- NULL = toàn cục
  feature_code  text NOT NULL,                          -- pro | full_tests | plan_full | notes | shadowing_grading ...
  source        text NOT NULL,                          -- subscription | org | promo | trial | admin
  source_id     uuid,
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_to      timestamptz,
  UNIQUE NULLS NOT DISTINCT (user_id, program_code, feature_code, source, source_id)
);
CREATE INDEX ix_entitlements_user_valid ON billing.entitlements(user_id, feature_code, valid_to);

CREATE TABLE billing.quotas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_kind    billing.plan_kind NOT NULL,              -- free | monthly/yearly/lifetime (Pro)
  feature_code text NOT NULL,                           -- explain | chat | voice_minutes | grade_writing | grade_speaking | shadowing_grade | video_translate | lesson | tool_essay_check
  period       billing.quota_period NOT NULL,
  limit_value  integer NOT NULL,
  UNIQUE (plan_kind, feature_code, period)
);

CREATE TABLE billing.usage_counters (                    -- chốt từ Redis hằng đêm
  user_id      uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  feature_code text NOT NULL,
  period_key   text NOT NULL,                           -- 2026-10-31 | 2026-10
  used         integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature_code, period_key)
);

CREATE TABLE billing.credit_ledger (                     -- append-only (ADR-11)
  id            bigserial PRIMARY KEY,
  user_id       uuid REFERENCES iam.users(id) ON DELETE CASCADE,
  org_id        uuid REFERENCES iam.organizations(id) ON DELETE CASCADE,
  delta         integer NOT NULL,
  balance_after integer NOT NULL,
  reason        billing.credit_reason NOT NULL,
  ref_type      text,
  ref_id        uuid,
  ai_task_id    uuid,                                   -- loose ref
  expires_at    timestamptz,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR org_id IS NOT NULL)
);
CREATE INDEX ix_credit_ledger_user_created ON billing.credit_ledger(user_id, created_at DESC);
CREATE INDEX ix_credit_ledger_org_created ON billing.credit_ledger(org_id, created_at DESC);

CREATE TABLE billing.credit_balances (
  owner_type text NOT NULL,                             -- user | org
  owner_id   uuid NOT NULL,
  balance    integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_type, owner_id)
);

CREATE TABLE billing.invoices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL UNIQUE REFERENCES billing.orders(id),
  provider    text NOT NULL,                            -- misa | viettel
  series      text,
  invoice_no  text,
  lookup_code text,
  status      text NOT NULL,                            -- issued | cancelled | replaced | error
  pdf_url     text,
  raw         jsonb,
  issued_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  buyer        jsonb,                                   -- v1.1 – Sprint 8: ảnh chụp người mua lúc phát hành {type, name, email, tax_code, company, address}
  cancelled_at timestamptz,                             -- v1.1 – Sprint 8: huỷ khi hoàn tiền
  updated_at   timestamptz NOT NULL DEFAULT now()       -- v1.1 – Sprint 8
);
CREATE INDEX ix_invoices_status ON billing.invoices(status, created_at);  -- v1.1 – Sprint 8: job invoice.retry
CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON billing.invoices FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();  -- v1.1 – Sprint 8

-- v1.1 – Sprint 8 (migration 0005): lượt dùng khuyến mãi – giữ lượt khi tạo đơn, đã dùng khi thanh toán/đổi mã, nhả khi đơn hết hạn
CREATE TABLE billing.promotion_redemptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id    uuid NOT NULL REFERENCES billing.promotions(id),
  user_id         uuid NOT NULL REFERENCES iam.users(id),
  order_id        uuid UNIQUE REFERENCES billing.orders(id),   -- NULL = đổi mã không qua đơn (trial_days, credit_bonus)
  subscription_id uuid REFERENCES billing.subscriptions(id),   -- trial_days: subscription trialing đã cấp
  kind            text NOT NULL,                        -- percent | fixed | credit_bonus | trial_days
  status          text NOT NULL DEFAULT 'reserved',     -- reserved | redeemed | released
  discount        numeric(14,2) NOT NULL DEFAULT 0,
  credits         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  redeemed_at     timestamptz,
  released_at     timestamptz,
  CHECK (status IN ('reserved','redeemed','released'))
);
CREATE INDEX ix_promotion_redemptions_promo_user ON billing.promotion_redemptions(promotion_id, user_id, status);
CREATE INDEX ix_promotion_redemptions_user ON billing.promotion_redemptions(user_id, created_at DESC);
CREATE UNIQUE INDEX ux_promotion_redemptions_trial_once ON billing.promotion_redemptions(user_id) WHERE kind = 'trial_days' AND status = 'redeemed';

CREATE TABLE billing.reconciliation_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       billing.payment_provider NOT NULL,
  for_date       date NOT NULL,
  expected_total numeric(14,2),
  actual_total   numeric(14,2),
  mismatches     jsonb NOT NULL DEFAULT '[]',
  status         text NOT NULL,                         -- matched | mismatched | error
  run_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, for_date)
);

CREATE TABLE billing.feature_flags (
  key        text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  rules      jsonb NOT NULL DEFAULT '{}',               -- {percent, user_ids[], plan_kinds[], programs[]}
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 6. OPS – audit, outbox, thông báo, phản hồi, hỗ trợ, báo cáo nội dung
-- =============================================================================
CREATE TYPE ops.notification_channel AS ENUM ('email','push','zalo','sms','inapp');

CREATE TABLE ops.audit_logs (
  id            bigserial,
  actor_user_id uuid,
  actor_role    text,
  action        text NOT NULL,                          -- content.publish, plan.update, user.grant_credits ...
  entity_type   text,
  entity_id     uuid,
  before        jsonb,
  after         jsonb,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX ix_audit_logs_entity ON ops.audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX ix_audit_logs_actor ON ops.audit_logs(actor_user_id, created_at DESC);

CREATE TABLE ops.outbox (                                -- domain events (ADR-06)
  id             bigserial,
  aggregate_type text NOT NULL,
  aggregate_id   uuid,
  event_type     text NOT NULL,                         -- attempt.graded, submission.graded, order.paid ...
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX ix_outbox_unpublished ON ops.outbox(created_at) WHERE published_at IS NULL;

CREATE TABLE ops.notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  channel       ops.notification_channel NOT NULL,
  template_code text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'scheduled',      -- scheduled | sent | failed | read | cancelled
  scheduled_at  timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  read_at       timestamptz,
  error         text
);
CREATE INDEX ix_notifications_user_status ON ops.notifications(user_id, status, scheduled_at DESC);
CREATE INDEX ix_notifications_due ON ops.notifications(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX ix_notifications_dedupe ON ops.notifications(user_id, template_code, ((payload ->> 'dedupe_key'))) WHERE payload ? 'dedupe_key';  -- v1.1 – Sprint 8

CREATE TABLE ops.notification_preferences (
  user_id     uuid PRIMARY KEY REFERENCES iam.users(id) ON DELETE CASCADE,
  channels    jsonb NOT NULL DEFAULT '{"email":true,"push":true,"zalo":false,"inapp":true}',
  quiet_hours jsonb NOT NULL DEFAULT '{"start":"22:00","end":"07:00"}',
  reminder_times text[] NOT NULL DEFAULT '{"20:00"}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- v1.1 – Sprint 8: tuỳ chọn theo loại × kênh (marketing mặc định tắt email/push – cần đồng ý)
  categories  jsonb NOT NULL DEFAULT '{"learning":{"email":true,"push":true,"inapp":true},"billing":{"email":true,"push":true,"inapp":true},"marketing":{"email":false,"push":false,"inapp":true}}'
);

-- v1.1 – Sprint 6 (migration 0004): đăng ký Web Push (VAPID) theo thiết bị; endpoint duy nhất toàn hệ thống
CREATE TABLE ops.push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,                 -- URL push service (bí mật theo thiết bị – không trả ra API)
  p256dh          text NOT NULL,                        -- khoá công khai ECDH của trình duyệt (base64url)
  auth            text NOT NULL,                        -- secret xác thực (base64url)
  expires_at      timestamptz,                          -- PushSubscription.expirationTime
  user_agent      text,
  locale          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count   smallint NOT NULL DEFAULT 0
);
CREATE INDEX ix_push_subscriptions_user ON ops.push_subscriptions(user_id);
CREATE TRIGGER trg_push_subscriptions_updated BEFORE UPDATE ON ops.push_subscriptions FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TABLE ops.feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES iam.users(id) ON DELETE SET NULL,
  kind       text NOT NULL,                             -- bug | idea | content_error | other
  body       text NOT NULL,
  page       text,
  context    jsonb,
  status     text NOT NULL DEFAULT 'new',               -- new | triaged | done | wontfix
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.content_reports (                       -- người học báo câu hỏi sai
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES iam.users(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'open',             -- open | confirmed | rejected | fixed
  resolved_by uuid REFERENCES iam.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX ix_content_reports_entity ON ops.content_reports(entity_type, entity_id, status);

CREATE TABLE ops.support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES iam.users(id) ON DELETE SET NULL,
  subject     text NOT NULL,
  body        text,
  channel     text,                                     -- inapp | email | zalo
  status      text NOT NULL DEFAULT 'open',
  priority    text NOT NULL DEFAULT 'normal',
  assigned_to uuid REFERENCES iam.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.jobs_deadletter (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue      text NOT NULL,
  job_id     text NOT NULL,
  payload    jsonb,
  error      text,
  attempts   smallint,
  failed_at  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 7. PARTITION – tạo partition tháng cho các bảng lớn (gọi bởi job hằng tháng)
-- =============================================================================
CREATE OR REPLACE FUNCTION ops.ensure_month_partition(p_schema text, p_table text, p_month date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := format('%s_%s', p_table, to_char(v_start, 'YYYYMM'));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = p_schema AND c.relname = v_name) THEN
    EXECUTE format('CREATE TABLE %I.%I PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)',
                   p_schema, v_name, p_schema, p_table, v_start, v_end);
  END IF;
END $$;

-- Tạo sẵn tháng hiện tại và 2 tháng tới
DO $$
DECLARE m date; t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES ('learn','attempt_answers'),('ai','ai_tasks'),('ops','audit_logs'),('ops','outbox')) AS v(s,tb) LOOP
    FOR i IN 0..2 LOOP
      m := (date_trunc('month', now()) + (i || ' month')::interval)::date;
      PERFORM ops.ensure_month_partition(t.s, t.tb, m);
    END LOOP;
  END LOOP;
END $$;

-- =============================================================================
-- 8. ROW LEVEL SECURITY – B2B (ADR-13). Ứng dụng đặt SET LOCAL app.org_id / app.user_id / app.role
-- =============================================================================
ALTER TABLE iam.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn.assignment_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_scope_classes ON iam.classes
  USING (current_setting('app.role', true) IN ('admin','superadmin','service')
         OR org_id::text = current_setting('app.org_id', true));
CREATE POLICY org_scope_memberships ON iam.org_memberships
  USING (current_setting('app.role', true) IN ('admin','superadmin','service')
         OR org_id::text = current_setting('app.org_id', true)
         OR user_id::text = current_setting('app.user_id', true));
CREATE POLICY org_scope_assignments ON learn.assignments
  USING (current_setting('app.role', true) IN ('admin','superadmin','service')
         OR org_id::text = current_setting('app.org_id', true));
CREATE POLICY org_scope_assignment_submissions ON learn.assignment_submissions
  USING (current_setting('app.role', true) IN ('admin','superadmin','service')
         OR user_id::text = current_setting('app.user_id', true)
         OR EXISTS (SELECT 1 FROM learn.assignments a WHERE a.id = assignment_id
                    AND a.org_id::text = current_setting('app.org_id', true)));

-- =============================================================================
-- 9. VIEW tiện ích
-- =============================================================================
CREATE OR REPLACE VIEW learn.v_user_program_summary AS
SELECT e.user_id, e.program_code, e.target_score, e.exam_date,
       (SELECT scaled_score FROM learn.attempts a WHERE a.user_id = e.user_id AND a.program_code = e.program_code
          AND a.status = 'graded' AND a.mode IN ('exam','diagnostic') ORDER BY a.submitted_at DESC LIMIT 1) AS last_scaled_score,
       (SELECT count(*) FROM learn.srs_cards c WHERE c.user_id = e.user_id AND c.program_code = e.program_code
          AND c.due_at <= now() AND NOT c.suspended) AS cards_due,
       s.current_streak
FROM learn.enrollments e
LEFT JOIN learn.streaks s ON s.user_id = e.user_id
WHERE e.is_active;

CREATE OR REPLACE VIEW billing.v_active_entitlements AS
SELECT user_id, program_code, feature_code, min(valid_from) AS valid_from, max(valid_to) AS valid_to
FROM billing.entitlements
WHERE valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
GROUP BY user_id, program_code, feature_code;

-- =============================================================================
-- 10. SEED tối thiểu – chương trình, vai trò, dạng câu hỏi (phần còn lại ở db/seed/)
-- =============================================================================
INSERT INTO catalog.programs (code, name, score_scale, languages, sort_order) VALUES
 ('toeic', '{"vi":"TOEIC","en":"TOEIC"}', '{"type":"toeic","lr":{"min":10,"max":990},"sw":{"min":0,"max":200}}', '{en}', 1),
 ('ielts', '{"vi":"IELTS","en":"IELTS"}', '{"type":"band","min":0,"max":9,"step":0.5}', '{en}', 2),
 ('jlpt',  '{"vi":"JLPT","en":"JLPT"}',   '{"type":"points","max":180,"levels":["N5","N4","N3","N2","N1"]}', '{ja}', 3),
 ('hsk',   '{"vi":"HSK","en":"HSK"}',     '{"type":"hsk3","levels":["1","2","3","4","5","6","7-9"]}', '{zh}', 4)
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.roles (code, description) VALUES
 ('learner','Người học'),('teacher','Giáo viên duyệt nội dung / chấm'),('editor','Biên tập nội dung'),
 ('admin','Quản trị vận hành'),('superadmin','Quản trị hệ thống'),('org_admin','Quản trị tổ chức B2B')
ON CONFLICT (code) DO NOTHING;

INSERT INTO catalog.question_types (code, name, content_schema, auto_gradable) VALUES
 ('mcq_single', '{"vi":"Trắc nghiệm 1 đáp án"}', '{"$ref":"schemas/question/mcq_single.json"}', true),
 ('mcq_multi',  '{"vi":"Trắc nghiệm nhiều đáp án"}', '{"$ref":"schemas/question/mcq_multi.json"}', true),
 ('fill_blank', '{"vi":"Điền từ/số"}', '{"$ref":"schemas/question/fill_blank.json"}', true),
 ('matching',   '{"vi":"Nối / Matching headings"}', '{"$ref":"schemas/question/matching.json"}', true),
 ('drag_drop',  '{"vi":"Kéo thả"}', '{"$ref":"schemas/question/drag_drop.json"}', true),
 ('map_label',  '{"vi":"Gán nhãn bản đồ/biểu đồ"}', '{"$ref":"schemas/question/map_label.json"}', true),
 ('tfng',       '{"vi":"True/False/Not Given"}', '{"$ref":"schemas/question/tfng.json"}', true),
 ('ordering',   '{"vi":"Sắp xếp"}', '{"$ref":"schemas/question/ordering.json"}', true),
 ('dictation',  '{"vi":"Nghe chép chính tả"}', '{"$ref":"schemas/question/dictation.json"}', true),
 ('essay',      '{"vi":"Viết tự luận"}', '{"$ref":"schemas/question/essay.json"}', false),
 ('speaking',   '{"vi":"Nói ghi âm"}', '{"$ref":"schemas/question/speaking.json"}', false),
 ('handwriting','{"vi":"Viết tay chữ Hán/Kanji"}', '{"$ref":"schemas/question/handwriting.json"}', false)
ON CONFLICT (code) DO NOTHING;

-- Khoá ngoại xuyên schema khai báo sau khi mọi bảng tồn tại
ALTER TABLE learn.grading_results ADD CONSTRAINT fk_grading_prompt_version FOREIGN KEY (prompt_version_id) REFERENCES ai.prompt_versions(id);
ALTER TABLE ai.ai_tasks ADD CONSTRAINT fk_ai_tasks_user FOREIGN KEY (user_id) REFERENCES iam.users(id) ON DELETE SET NULL;

-- Hết DDL v1.0
