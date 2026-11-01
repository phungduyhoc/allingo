output "log_analytics_workspace_id" {
  description = "Resource ID (dùng cho Container Apps Environment)"
  value       = azurerm_log_analytics_workspace.this.id
}

output "log_analytics_workspace_customer_id" {
  value = azurerm_log_analytics_workspace.this.workspace_id
}

output "app_insights_connection_string" {
  value     = azurerm_application_insights.this.connection_string
  sensitive = true
}

output "app_insights_id" {
  value = azurerm_application_insights.this.id
}
