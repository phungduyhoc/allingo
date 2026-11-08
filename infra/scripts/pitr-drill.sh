#!/usr/bin/env bash
# Diễn tập PITR (Sprint 11) trên PostgreSQL 16 cục bộ – KHÔNG khởi động lại / KHÔNG đổi cấu hình cluster chính.
#
# Cơ chế lưu trữ WAL: `pg_receivewal` stream WAL qua replication slot vào thư mục (giống Barman streaming archiver),
# thay cho `archive_mode=on` (đổi tham số đó bắt buộc restart cluster chính → CMS/API mất kết nối). Base backup bằng
# `pg_basebackup -X stream`. Khôi phục vào cluster TẠM (cổng 5440, socket riêng) với `recovery_target_time`.
#
# Dùng:
#   infra/scripts/pitr-drill.sh start      # slot + pg_receivewal + base backup + workload nền (WORKLOAD_MINUTES, mặc định 13)
#   infra/scripts/pitr-drill.sh status
#   infra/scripts/pitr-drill.sh incident   # "sự cố": xoá dữ liệu drill (DELETE + DROP TABLE)
#   infra/scripts/pitr-drill.sh restore    # khôi phục về now − TARGET_MINUTES_AGO (mặc định 10) → đo RTO, kiểm dữ liệu
#   infra/scripts/pitr-drill.sh restore-latest  # khôi phục tới WAL mới nhất trong archive → đo RPO
#   infra/scripts/pitr-drill.sh cleanup    # dừng cluster tạm, pg_receivewal, xoá slot + thư mục + DB drill
#
# Kết quả: $DRILL_DIR/timeline.log, $DRILL_DIR/result-*.json (dùng cho docs/runbooks/restore.md).
set -euo pipefail

PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
DRILL_DIR=${DRILL_DIR:-/var/lib/postgresql/pitr-drill}
SLOT=${SLOT:-pitr_drill}
DRILL_DB=${DRILL_DB:-allingo_drill}
TEMP_PORT=${TEMP_PORT:-5440}
TEMP_SOCK=${TEMP_SOCK:-$DRILL_DIR/sock}
WORKLOAD_MINUTES=${WORKLOAD_MINUTES:-13}
TARGET_MINUTES_AGO=${TARGET_MINUTES_AGO:-10}

as_pg() { su postgres -s /bin/bash -c "$*"; }
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ) $*" | tee -a "$DRILL_DIR/timeline.log"; }
now_ms() { date +%s%3N; }
psql_main() { as_pg "psql -X -At -d ${1} -c \"${2}\""; }
psql_temp() { as_pg "psql -X -At -h $TEMP_SOCK -p $TEMP_PORT -d ${1} -c \"${2}\""; }

start() {
  mkdir -p "$DRILL_DIR"/{wal,base,run}
  chown -R postgres:postgres "$DRILL_DIR"
  : > "$DRILL_DIR/timeline.log"
  log "start: tạo DB drill + slot $SLOT"
  psql_main postgres "DROP DATABASE IF EXISTS $DRILL_DB" >/dev/null
  psql_main postgres "CREATE DATABASE $DRILL_DB" >/dev/null
  psql_main "$DRILL_DB" "CREATE TABLE drill_markers (id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT clock_timestamp(), note text NOT NULL); CREATE TABLE drill_orders (id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), amount int NOT NULL); INSERT INTO drill_markers(note) VALUES ('before-basebackup');" >/dev/null
  as_pg "$PG_BIN/pg_receivewal -d 'dbname=postgres' --slot=$SLOT --create-slot --if-not-exists" || true
  as_pg "setsid nohup $PG_BIN/pg_receivewal -d 'dbname=postgres' -D $DRILL_DIR/wal --slot=$SLOT --synchronous --no-loop > $DRILL_DIR/run/receivewal.log 2>&1 & echo \$! > $DRILL_DIR/run/receivewal.pid"
  sleep 1
  log "pg_receivewal pid $(cat "$DRILL_DIR/run/receivewal.pid")"
  local t0; t0=$(now_ms)
  as_pg "$PG_BIN/pg_basebackup -d 'dbname=postgres' -D $DRILL_DIR/base -X stream -c fast --no-password"
  local t1; t1=$(now_ms)
  log "basebackup xong: $(( t1 - t0 )) ms, kích thước $(du -sh "$DRILL_DIR/base" | cut -f1)"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DRILL_DIR/run/basebackup_at"
  # Workload nền: 1 marker / 20 s, 500 đơn / 2 phút; ghi id + ts đã commit ra tệp (đối chiếu sau khôi phục)
  as_pg "setsid nohup bash -c 'end=\$((\$(date +%s) + $WORKLOAD_MINUTES * 60)); i=0; while [ \$(date +%s) -lt \$end ]; do psql -X -At -d $DRILL_DB -c \"INSERT INTO drill_markers(note) VALUES ('\''tick-'\''||\$i) RETURNING id, ts\" >> $DRILL_DIR/run/committed.txt; if [ \$((i % 6)) -eq 0 ]; then psql -X -q -d $DRILL_DB -c \"INSERT INTO drill_orders(amount) SELECT (random()*500000)::int FROM generate_series(1,500)\"; fi; i=\$((i+1)); sleep 20; done; echo done > $DRILL_DIR/run/workload.done' > $DRILL_DIR/run/workload.log 2>&1 &"
  log "workload nền chạy $WORKLOAD_MINUTES phút"
}

status() {
  echo "receivewal: $(kill -0 "$(cat "$DRILL_DIR/run/receivewal.pid" 2>/dev/null)" 2>/dev/null && echo running || echo stopped)"
  echo "markers committed: $(grep -cE '^[0-9]+\|' "$DRILL_DIR/run/committed.txt" 2>/dev/null || echo 0)"
  echo "workload done: $([ -f "$DRILL_DIR/run/workload.done" ] && echo yes || echo no)"
  echo "wal files: $(ls "$DRILL_DIR/wal" | wc -l), archive size $(du -sh "$DRILL_DIR/wal" | cut -f1)"
  psql_main postgres "SELECT slot_name, active, restart_lsn, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained FROM pg_replication_slots WHERE slot_name = '$SLOT'"
}

# Workload bổ sung (phút) – dùng khi cần thêm thay đổi SAU mốc khôi phục để kiểm PITR loại bỏ đúng
workload() {
  local minutes=${1:-3}
  rm -f "$DRILL_DIR/run/workload.done"
  as_pg "setsid nohup bash -c 'end=\$((\$(date +%s) + $minutes * 60)); i=1000; while [ \$(date +%s) -lt \$end ]; do psql -X -At -d $DRILL_DB -c \"INSERT INTO drill_markers(note) VALUES ('\''late-'\''||\$i) RETURNING id, ts\" >> $DRILL_DIR/run/committed.txt; i=\$((i+1)); sleep 15; done; echo done > $DRILL_DIR/run/workload.done' >> $DRILL_DIR/run/workload.log 2>&1 &"
  log "workload bổ sung $minutes phút"
}

incident() {
  local last; last=$(psql_main "$DRILL_DB" "SELECT max(id) || '|' || max(ts) FROM drill_markers")
  echo "$last" > "$DRILL_DIR/run/last_before_incident"
  psql_main "$DRILL_DB" "DELETE FROM drill_markers; DROP TABLE drill_orders;" >/dev/null
  echo "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" > "$DRILL_DIR/run/incident_at"
  log "SỰ CỐ: DELETE drill_markers + DROP drill_orders (marker cuối trước sự cố: $last)"
}

# $1 = thư mục khôi phục, $2 = recovery_target_time (rỗng = tới WAL mới nhất)
prepare_restore_dir() {
  local dir=$1 target=$2
  rm -rf "$dir"; mkdir -p "$dir" "$TEMP_SOCK"
  cp -a "$DRILL_DIR/base/." "$dir/"
  rm -f "$dir/postgresql.auto.conf"
  cp /etc/postgresql/16/main/pg_hba.conf "$dir/pg_hba.conf"
  cp /etc/postgresql/16/main/pg_ident.conf "$dir/pg_ident.conf"
  cat > "$dir/postgresql.conf" <<EOF
# Cluster TẠM cho diễn tập PITR – không đụng cluster chính
port = $TEMP_PORT
listen_addresses = ''
unix_socket_directories = '$TEMP_SOCK'
hba_file = '$dir/pg_hba.conf'
ident_file = '$dir/pg_ident.conf'
shared_buffers = 64MB
# Phải ≥ giá trị của primary (bài học diễn tập S11: 20 < 100 → "recovery aborted because of insufficient parameter settings")
max_connections = 100
ssl = off
archive_mode = off
restore_command = 'cp $DRILL_DIR/restore-wal/%f %p'
recovery_target_action = 'promote'
recovery_target_timeline = 'latest'
EOF
  if [ -n "$target" ]; then echo "recovery_target_time = '$target'" >> "$dir/postgresql.conf"; echo "recovery_target_inclusive = true" >> "$dir/postgresql.conf"; fi
  touch "$dir/recovery.signal"
  # Bản sao WAL để khôi phục: segment đầy đủ + segment .partial đổi tên (WAL mới nhất của pg_receivewal)
  rm -rf "$DRILL_DIR/restore-wal"; mkdir -p "$DRILL_DIR/restore-wal"
  cp "$DRILL_DIR"/wal/* "$DRILL_DIR/restore-wal/" 2>/dev/null || true
  for p in "$DRILL_DIR"/restore-wal/*.partial; do [ -e "$p" ] && mv "$p" "${p%.partial}"; done
  chown -R postgres:postgres "$dir" "$TEMP_SOCK" "$DRILL_DIR/restore-wal"
  chmod 700 "$dir"
}

wait_promoted() {
  for _ in $(seq 1 600); do
    if as_pg "$PG_BIN/pg_isready -q -h $TEMP_SOCK -p $TEMP_PORT" && [ "$(psql_temp postgres 'SELECT pg_is_in_recovery()' 2>/dev/null)" = "f" ]; then return 0; fi
    sleep 0.2
  done
  return 1
}

restore() {
  local target; target=${RECOVERY_TARGET_TIME:-$(date -u -d "-$TARGET_MINUTES_AGO minutes" +%Y-%m-%dT%H:%M:%S+00)}
  local dir="$DRILL_DIR/restore-pitr"
  log "restore: bắt đầu, recovery_target_time = $target"
  local t0; t0=$(now_ms)
  prepare_restore_dir "$dir" "$target"
  local t1; t1=$(now_ms)
  as_pg "$PG_BIN/pg_ctl -D $dir -l $DRILL_DIR/run/restore-pitr.log -w -t 600 start" >/dev/null
  wait_promoted
  local t2; t2=$(now_ms)
  local got expected maxts users
  got=$(psql_temp "$DRILL_DB" "SELECT count(*) FROM drill_markers")
  maxts=$(psql_temp "$DRILL_DB" "SELECT max(ts) FROM drill_markers")
  # committed.txt: dòng "id|ts" (bỏ dòng thẻ lệnh psql); +1 = marker 'before-basebackup'
  expected=$(awk -F'|' -v t="$target" 'BEGIN{n=0} /^[0-9]+\|/ { ts=$2; sub(/ /,"T",ts); sub(/\+00$/,"",ts); tt=t; sub(/\+00$/,"",tt); if (ts <= tt) n++ } END{print n+1}' "$DRILL_DIR/run/committed.txt")
  users=$(psql_temp allingo "SELECT count(*) FROM iam.users" 2>/dev/null || echo "?")
  local orders; orders=$(psql_temp "$DRILL_DB" "SELECT count(*) FROM drill_orders" 2>/dev/null || echo "?")
  log "restore xong: chuẩn bị (copy base + WAL) $(( t1 - t0 )) ms, replay + promote $(( t2 - t1 )) ms, RTO kỹ thuật $(( t2 - t0 )) ms"
  log "kiểm dữ liệu: markers khôi phục = $got (kỳ vọng ≤ target: $expected), max(ts) = $maxts, drill_orders = $orders, iam.users (DB dev) = $users"
  cat > "$DRILL_DIR/result-pitr.json" <<EOF
{"target_time":"$target","prepare_ms":$(( t1 - t0 )),"replay_promote_ms":$(( t2 - t1 )),"rto_ms":$(( t2 - t0 )),"markers_restored":$got,"markers_expected":$expected,"max_marker_ts":"$maxts","drill_orders":"$orders","dev_users":"$users","base_size":"$(du -sh "$DRILL_DIR/base" | cut -f1)","wal_files":$(ls "$DRILL_DIR/wal" | wc -l)}
EOF
  as_pg "$PG_BIN/pg_ctl -D $dir -m fast -w stop" >/dev/null
  log "cluster tạm (PITR) đã dừng"
}

restore_latest() {
  local dir="$DRILL_DIR/restore-latest"
  log "restore-latest: bắt đầu (tới WAL mới nhất trong archive)"
  local t0; t0=$(now_ms)
  prepare_restore_dir "$dir" ""
  as_pg "$PG_BIN/pg_ctl -D $dir -l $DRILL_DIR/run/restore-latest.log -w -t 600 start" >/dev/null
  wait_promoted
  local t1; t1=$(now_ms)
  # Sự cố đã xoá markers → bản "latest" cũng thấy bảng rỗng; đo RPO bằng LSN/commit cuối có trong archive so với primary
  local last_primary last_restored_commit
  last_primary=$(cut -d'|' -f2 < "$DRILL_DIR/run/last_before_incident" 2>/dev/null || echo "")
  last_restored_commit=$(psql_temp postgres "SELECT pg_last_committed_xact()" 2>/dev/null || echo "")
  local incident_at; incident_at=$(cat "$DRILL_DIR/run/incident_at" 2>/dev/null || echo "")
  local tables; tables=$(psql_temp "$DRILL_DB" "SELECT count(*) FROM pg_tables WHERE tablename = 'drill_orders'")
  log "restore-latest xong sau $(( t1 - t0 )) ms; drill_orders tồn tại = $tables (0 = archive chứa cả lệnh DROP lúc $incident_at → RPO ≈ 0)"
  cat > "$DRILL_DIR/result-latest.json" <<EOF
{"rto_ms":$(( t1 - t0 )),"incident_at":"$incident_at","last_marker_before_incident":"$last_primary","drill_orders_table_present":$tables}
EOF
  as_pg "$PG_BIN/pg_ctl -D $dir -m fast -w stop" >/dev/null
}

cleanup() {
  for d in restore-pitr restore-latest; do
    [ -f "$DRILL_DIR/$d/postmaster.pid" ] && as_pg "$PG_BIN/pg_ctl -D $DRILL_DIR/$d -m fast -w stop" || true
  done
  if [ -f "$DRILL_DIR/run/receivewal.pid" ]; then kill "$(cat "$DRILL_DIR/run/receivewal.pid")" 2>/dev/null || true; sleep 1; fi
  psql_main postgres "SELECT pg_drop_replication_slot('$SLOT') FROM pg_replication_slots WHERE slot_name = '$SLOT'" >/dev/null || true
  psql_main postgres "DROP DATABASE IF EXISTS $DRILL_DB" >/dev/null || true
  mkdir -p /tmp/pitr-drill-results && cp "$DRILL_DIR"/timeline.log "$DRILL_DIR"/result-*.json /tmp/pitr-drill-results/ 2>/dev/null || true
  rm -rf "$DRILL_DIR"
  echo "cleanup xong (kết quả sao lưu tại /tmp/pitr-drill-results)"
}

case "${1:-}" in
  start) start ;;
  status) status ;;
  workload) workload "${2:-3}" ;;
  incident) incident ;;
  restore) restore ;;
  restore-latest) restore_latest ;;
  cleanup) cleanup ;;
  *) echo "usage: $0 start|status|incident|restore|restore-latest|cleanup" >&2; exit 2 ;;
esac
