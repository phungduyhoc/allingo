output "server_id" {
  value = azurerm_postgresql_flexible_server.this.id
}

output "server_name" {
  value = azurerm_postgresql_flexible_server.this.name
}

output "fqdn" {
  value = local.host
}

output "database_name" {
  value = azurerm_postgresql_flexible_server_database.app.name
}

output "admin_login" {
  value = var.administrator_login
}

# Chuỗi kết nối cho migration (admin). sslmode=require bắt buộc trên Flexible Server.
output "admin_connection_string" {
  value     = "postgres://${var.administrator_login}:${urlencode(random_password.admin.result)}@${local.host}:5432/${var.database_name}?sslmode=require"
  sensitive = true
}

# Chuỗi kết nối runtime (vai trò app, không BYPASSRLS) – có hiệu lực sau khi chạy job dbtools
output "app_connection_string" {
  value     = "postgres://${var.app_role_name}:${urlencode(random_password.app.result)}@${local.host}:5432/${var.database_name}?sslmode=require"
  sensitive = true
}

output "bootstrap_roles_sql" {
  description = "SQL tạo vai trò app (chứa mật khẩu) – nạp vào Key Vault để job dbtools chạy"
  value       = local.bootstrap_sql
  sensitive   = true
}
