# State lưu trên Azure Storage (blob, khoá lease chống apply đồng thời), xác thực bằng Entra ID – không dùng access key.
# Giá trị cụ thể (RG, storage account, container) KHÔNG ghi ở đây để dùng chung cấu hình cho local và CI:
#   local : terraform init -backend-config=backend.local.hcl
#   CI    : terraform init -backend-config="resource_group_name=..." ... (deploy-staging.yml, OIDC: use_oidc=true)
#   kiểm tra cú pháp không cần state: terraform init -backend=false (scripts/validate.sh)
# Principal chạy Terraform cần vai trò "Storage Blob Data Contributor" trên container tfstate.
terraform {
  backend "azurerm" {
    key              = "allingo/staging.tfstate"
    use_azuread_auth = true
  }
}
