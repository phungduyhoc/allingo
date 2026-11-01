output "app_name" {
  value = azurerm_container_app.meili.name
}

output "internal_host" {
  description = "URL nội bộ trong Container Apps Environment (MEILISEARCH_HOST)"
  value       = "http://${azurerm_container_app.meili.name}"
}

output "internal_fqdn" {
  value = azurerm_container_app.meili.ingress[0].fqdn
}
