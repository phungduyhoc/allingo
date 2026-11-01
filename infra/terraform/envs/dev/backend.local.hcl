# Cấu hình backend MẪU cho máy dev: terraform init -backend-config=backend.local.hcl
# Sửa theo tài nguyên state đã tạo ở bước Bootstrap (infra/terraform/README.md). Tệp không chứa secret
# (xác thực bằng `az login` + Entra ID), nhưng đừng commit giá trị của tài khoản thật nếu repo public.
resource_group_name  = "allingo-tfstate-rg"
storage_account_name = "stallingotfstate"   # 3–24 ký tự chữ thường/số, duy nhất toàn cầu
container_name       = "tfstate"
key                  = "allingo/dev.tfstate"
use_azuread_auth     = true
# subscription_id    = "00000000-0000-0000-0000-000000000000"  # nếu state nằm ở subscription khác
