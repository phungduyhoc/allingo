-- Migration 0008 (spec v1.1 – Sprint 11): index hiệu năng từ load test (docs/perf/report-S11.md).
-- 1) learn.xp_events(ref_type, ref_id) WHERE ref_id IS NOT NULL – chống trùng XP theo tham chiếu (attempt.graded, plan_task,
--    srs_review): trước đây Seq Scan toàn bảng mỗi lần chấm bài (bảng lớn dần theo mọi người dùng).
-- Quy ước concurrent-safe (S11): `CREATE INDEX IF NOT EXISTS` + chú thích `-- concurrent-safe`; db/scripts/migrate.ts tạo trước
-- bằng CREATE INDEX CONCURRENTLY (ngoài transaction) khi bảng đã tồn tại và migration chưa áp → lệnh dưới đây thành no-op,
-- không khoá ghi bảng lớn trên staging/production. DB mới (bảng rỗng) tạo trong transaction như thường.
-- KHÔNG sửa tay sau khi phát hành; thay đổi tiếp theo = migration mới + cập nhật docs/spec/allingo-schema.sql.

-- concurrent-safe
CREATE INDEX IF NOT EXISTS ix_xp_events_ref ON learn.xp_events(ref_type, ref_id) WHERE ref_id IS NOT NULL;
