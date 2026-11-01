# Key Vault (RBAC) giữ mọi secret runtime; Container Apps đọc qua user-assigned managed identity
# (secret block `key_vault_secret_id` + `identity`). Người/pipeline chạy Terraform cần "Key Vault Secrets Officer".
# Tên secret trong Key Vault chỉ gồm chữ/số/gạch ngang: ENV `DATABASE_URL` → `database-url` (xem envs/*/main.tf).

data "azurerm_client_config" "current" {}

resource "azurerm_user_assigned_identity" "apps" {
  name                = "${var.name_prefix}-apps-id"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_key_vault" "this" {
  name                          = var.key_vault_name
  location                      = var.location
  resource_group_name           = var.resource_group_name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  purge_protection_enabled      = var.purge_protection_enabled
  soft_delete_retention_days    = 7
  public_network_access_enabled = true # GitHub runner (terraform) cần tới; Container Apps đi qua backbone Azure
  tags                          = var.tags
}

# Người/pipeline đang apply được ghi secret
resource "azurerm_role_assignment" "deployer_secrets_officer" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

# Identity của Container Apps chỉ đọc secret
resource "azurerm_role_assignment" "apps_secrets_user" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.apps.principal_id
}

# Role assignment Azure RBAC cần vài chục giây để có hiệu lực trước khi ghi secret.
# Chờ cả quyền của identity app: Container Apps tham chiếu secret qua output `secret_ids` (phụ thuộc
# vào các secret bên dưới) nên sẽ chỉ được tạo sau khi identity đã đọc được Key Vault.
resource "time_sleep" "rbac_propagation" {
  depends_on = [
    azurerm_role_assignment.deployer_secrets_officer,
    azurerm_role_assignment.apps_secrets_user,
  ]
  create_duration = "60s"
}

resource "azurerm_key_vault_secret" "this" {
  # var.secrets là sensitive → không dùng trực tiếp làm for_each (Terraform báo lỗi);
  # tên secret không bí mật nên bỏ đánh dấu sensitive cho tập khoá.
  for_each = nonsensitive(toset(keys(var.secrets)))

  name         = each.key
  value        = var.secrets[each.key]
  key_vault_id = azurerm_key_vault.this.id
  content_type = "text/plain"
  tags         = var.tags

  depends_on = [time_sleep.rbac_propagation]
}
