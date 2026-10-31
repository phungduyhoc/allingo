-- Chạy một lần khi khởi tạo volume Postgres (dev). Tạo vai trò runtime cho API không có BYPASSRLS (CLAUDE.md §5.10)
CREATE ROLE allingo_app LOGIN PASSWORD 'allingo_app' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE allingo_test OWNER allingo;
