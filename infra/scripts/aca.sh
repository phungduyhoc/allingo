#!/usr/bin/env bash
# Tiện ích az CLI cho Azure Container Apps – dùng trong .github/workflows/deploy-staging.yml và
# docs/runbooks/deploy-staging.md. Cần: az CLI đã đăng nhập + extension containerapp.
#
#   aca.sh job-run        <rg> <job> [image]              # (cập nhật image) → start → chờ Succeeded/Failed
#   aca.sh app-deploy     <rg> <app> <image> <suffix>     # revision mới → chờ healthy → 100% traffic (Multiple)
#   aca.sh deactivate-old <rg> <app> <keep-revision>      # tắt mọi revision đang active khác <keep-revision>
#   aca.sh rollback       <rg> <app> <revision>           # bật lại revision cũ → 100% traffic → tắt revision lỗi
#   aca.sh status         <rg> <app>                      # liệt kê revision, trạng thái, traffic
#
# Biến tuỳ chọn: WAIT_ATTEMPTS (mặc định 60), WAIT_SECONDS (10).
set -euo pipefail

WAIT_ATTEMPTS="${WAIT_ATTEMPTS:-60}"
WAIT_SECONDS="${WAIT_SECONDS:-10}"

log() { printf '%s\n' "$*" >&2; }
die() {
  log "✗ $*"
  exit 1
}

# Chờ revision Provisioned và Healthy (app có probe) hoặc Running (worker không probe)
wait_revision() {
  local rg=$1 app=$2 rev=$3 i state prov health running
  for ((i = 1; i <= WAIT_ATTEMPTS; i++)); do
    state="$(az containerapp revision show -g "$rg" -n "$app" --revision "$rev" \
      --query "[properties.provisioningState, properties.healthState, properties.runningState]" -o tsv 2> /dev/null || true)"
    read -r prov health running <<< "$(printf '%s' "$state" | tr '\t\n' '  ')"
    log "  [$i/$WAIT_ATTEMPTS] $rev provisioning=${prov:-?} health=${health:-?} running=${running:-?}"
    if [[ "$prov" == "Failed" || "$running" == "Failed" ]]; then
      return 1
    fi
    if [[ "$prov" == "Provisioned" ]]; then
      if [[ "$health" == "Healthy" ]] || [[ "$health" == "None" && "$running" == "Running" ]]; then
        return 0
      fi
    fi
    sleep "$WAIT_SECONDS"
  done
  return 1
}

has_ingress() {
  local rg=$1 app=$2
  [[ -n "$(az containerapp show -g "$rg" -n "$app" --query "properties.configuration.ingress.fqdn" -o tsv 2> /dev/null)" ]]
}

cmd_job_run() {
  local rg=$1 job=$2 image=${3:-} exec_name status i
  if [[ -n "$image" ]]; then
    log "→ $job: image $image"
    az containerapp job update -g "$rg" -n "$job" --image "$image" -o none
  fi
  exec_name="$(az containerapp job start -g "$rg" -n "$job" --query name -o tsv)"
  [[ -n "$exec_name" ]] || die "Không start được job $job"
  log "→ $job: execution $exec_name"
  for ((i = 1; i <= WAIT_ATTEMPTS * 2; i++)); do
    status="$(az containerapp job execution show -g "$rg" -n "$job" --job-execution-name "$exec_name" \
      --query properties.status -o tsv 2> /dev/null || true)"
    log "  [$i] $status"
    case "$status" in
      Succeeded)
        log "✓ $job ($exec_name) thành công"
        return 0
        ;;
      Failed | Stopped | Degraded)
        log "Log: az containerapp job logs show -g $rg -n $job --execution $exec_name --container ${job##*-}"
        log "KQL: ContainerAppConsoleLogs_CL | where ContainerJobName_s == '$job' and ContainerGroupName_s startswith '$exec_name'"
        die "$job ($exec_name) kết thúc với trạng thái $status"
        ;;
    esac
    sleep "$WAIT_SECONDS"
  done
  die "Quá thời gian chờ $job ($exec_name)"
}

cmd_app_deploy() {
  local rg=$1 app=$2 image=$3 suffix=$4 mode prev rev
  mode="$(az containerapp show -g "$rg" -n "$app" --query properties.configuration.activeRevisionsMode -o tsv)"
  prev="$(az containerapp show -g "$rg" -n "$app" --query properties.latestReadyRevisionName -o tsv)"
  rev="${app}--${suffix}"
  log "→ $app ($mode): $prev → $rev ($image)"
  az containerapp update -g "$rg" -n "$app" --image "$image" --revision-suffix "$suffix" -o none
  if ! wait_revision "$rg" "$app" "$rev"; then
    log "Revision $rev không healthy. Traffic vẫn ở $prev (Multiple) hoặc ACA giữ revision cũ (Single)."
    die "Deploy $app thất bại"
  fi
  if [[ "$mode" == "Multiple" ]] && has_ingress "$rg" "$app"; then
    # Sau rollback traffic có thể đang ghim vào revision cụ thể → luôn trả về chế độ "latest"
    az containerapp ingress traffic set -g "$rg" -n "$app" --revision-weight latest=100 -o none
  fi
  log "✓ $app: $rev nhận 100% traffic"
  # stdout: tên revision cũ (để workflow ghi vào summary phục vụ rollback)
  printf '%s\n' "$prev"
}

cmd_deactivate_old() {
  local rg=$1 app=$2 keep=$3 r
  while read -r r; do
    [[ -n "$r" && "$r" != "$keep" ]] || continue
    log "  tắt revision $r"
    az containerapp revision deactivate -g "$rg" -n "$app" --revision "$r" -o none
  done < <(az containerapp revision list -g "$rg" -n "$app" --query "[?properties.active].name" -o tsv)
}

cmd_rollback() {
  local rg=$1 app=$2 target=$3 current
  current="$(az containerapp show -g "$rg" -n "$app" --query properties.latestReadyRevisionName -o tsv)"
  log "→ rollback $app: $current → $target"
  az containerapp revision activate -g "$rg" -n "$app" --revision "$target" -o none
  wait_revision "$rg" "$app" "$target" || die "Revision $target không healthy"
  if has_ingress "$rg" "$app"; then
    az containerapp ingress traffic set -g "$rg" -n "$app" --revision-weight "${target}=100" -o none
  fi
  if [[ -n "$current" && "$current" != "$target" ]]; then
    az containerapp revision deactivate -g "$rg" -n "$app" --revision "$current" -o none
  fi
  log "✓ $app: 100% traffic về $target (traffic đang ghim – lần deploy sau tự trả về 'latest')"
}

cmd_status() {
  local rg=$1 app=$2
  az containerapp revision list -g "$rg" -n "$app" -o table \
    --query "[].{revision:name, active:properties.active, traffic:properties.trafficWeight, health:properties.healthState, running:properties.runningState, created:properties.createdTime, image:properties.template.containers[0].image}"
}

usage() {
  sed -n '2,12p' "$0" >&2
  exit 2
}

cmd="${1:-}"
shift || true
case "$cmd" in
  job-run) [[ $# -ge 2 ]] || usage; cmd_job_run "$@" ;;
  app-deploy) [[ $# -eq 4 ]] || usage; cmd_app_deploy "$@" ;;
  deactivate-old) [[ $# -eq 3 ]] || usage; cmd_deactivate_old "$@" ;;
  rollback) [[ $# -eq 3 ]] || usage; cmd_rollback "$@" ;;
  status) [[ $# -eq 2 ]] || usage; cmd_status "$@" ;;
  *) usage ;;
esac
