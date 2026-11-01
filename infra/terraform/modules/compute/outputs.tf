output "environment_id" {
  value = azurerm_container_app_environment.this.id
}

output "environment_name" {
  value = azurerm_container_app_environment.this.name
}

output "environment_default_domain" {
  description = "<id>.<region>.azurecontainerapps.io – FQDN app external = <tên app>.<default_domain>"
  value       = azurerm_container_app_environment.this.default_domain
}

output "environment_static_ip" {
  value = azurerm_container_app_environment.this.static_ip_address
}

# Giá trị TXT asuid.<hostname> để Azure xác minh custom domain (module dns)
output "custom_domain_verification_id" {
  value     = azurerm_container_app_environment.this.custom_domain_verification_id
  sensitive = true
}

# Chỉ phụ thuộc name_prefix (không phụ thuộc tài nguyên) → envs/*/main.tf dùng được để dựng URL nội bộ mà không tạo vòng
output "app_names" {
  value = {
    api    = local.names.api
    worker = local.names.worker
    web    = local.names.web
    cms    = local.names.cms
    otel   = local.names.otel
  }
}

output "job_names" {
  value = {
    migrate = local.names.migrate
    dbtools = local.names.dbtools
  }
}

output "fqdns" {
  description = "FQDN mặc định của từng app có ingress external"
  value = {
    api = azurerm_container_app.api.ingress[0].fqdn
    web = azurerm_container_app.web.ingress[0].fqdn
    cms = azurerm_container_app.cms.ingress[0].fqdn
  }
}

output "api_fqdn" {
  value = azurerm_container_app.api.ingress[0].fqdn
}

output "web_fqdn" {
  value = azurerm_container_app.web.ingress[0].fqdn
}

output "cms_fqdn" {
  value = azurerm_container_app.cms.ingress[0].fqdn
}

output "identity_id" {
  description = "User-assigned identity gắn cho mọi app/job (đọc Key Vault)"
  value       = var.identity_id
}

# Chỉ dựa trên tên (không phụ thuộc tài nguyên otel) để api/worker dùng làm OTEL_EXPORTER_OTLP_ENDPOINT
output "otel_internal_endpoint" {
  value = var.otel_collector.enabled ? "http://${local.names.otel}" : null
}

output "cms_media_storage_account_name" {
  value = azurerm_storage_account.cms_media.name
}

output "custom_domains" {
  value = { for k, d in azurerm_container_app_custom_domain.this : k => d.name }
}
