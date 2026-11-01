#!/usr/bin/env bash
# Kiểm tra IaC không cần credentials/state:
#   1) terraform fmt -check -recursive  (toàn bộ infra/terraform)
#   2) với mỗi envs/<env>: terraform init -backend=false + terraform validate
#   3) cảnh báo nếu envs/dev/main.tf và envs/staging/main.tf lệch nhau (quy ước: giống hệt, khác ở variables/tfvars)
#
# Dùng:  infra/terraform/scripts/validate.sh           # kiểm tra
#        FMT_FIX=1 infra/terraform/scripts/validate.sh # tự định dạng trước khi kiểm tra
# Cần terraform >= 1.9 và mạng tới registry.terraform.io (tải provider lần đầu; cache ở TF_PLUGIN_CACHE_DIR nếu đặt).
set -euo pipefail

TF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v terraform > /dev/null 2>&1; then
  echo "✗ Không tìm thấy terraform (>= 1.9). Cài: https://developer.hashicorp.com/terraform/install" >&2
  exit 127
fi
echo "terraform: $(terraform version | head -n 1)"

status=0

if [[ "${FMT_FIX:-0}" == "1" ]]; then
  echo "==> terraform fmt -recursive (ghi tệp)"
  terraform -chdir="$TF_ROOT" fmt -recursive
fi

echo "==> terraform fmt -check -recursive"
if ! terraform -chdir="$TF_ROOT" fmt -check -recursive -diff; then
  echo "✗ Sai định dạng – chạy: FMT_FIX=1 $0" >&2
  status=1
fi

for env_dir in "$TF_ROOT"/envs/*/; do
  env_name="$(basename "$env_dir")"
  [[ -f "$env_dir/main.tf" ]] || continue

  echo "==> [$env_name] terraform init -backend=false"
  if ! init_log="$(terraform -chdir="$env_dir" init -backend=false -input=false -no-color 2>&1)"; then
    echo "$init_log" >&2
    echo "✗ [$env_name] init lỗi" >&2
    status=1
    continue
  fi

  echo "==> [$env_name] terraform validate"
  if ! terraform -chdir="$env_dir" validate -no-color; then
    status=1
  fi
done

if [[ -f "$TF_ROOT/envs/dev/main.tf" && -f "$TF_ROOT/envs/staging/main.tf" ]]; then
  if ! diff -q "$TF_ROOT/envs/dev/main.tf" "$TF_ROOT/envs/staging/main.tf" > /dev/null; then
    echo "⚠ envs/dev/main.tf khác envs/staging/main.tf – kiểm tra lại (khác biệt nên nằm ở variables.tf/tfvars)" >&2
  fi
fi

if [[ $status -eq 0 ]]; then
  echo "✓ Terraform hợp lệ"
else
  echo "✗ Có lỗi (xem phía trên)" >&2
fi
exit $status
