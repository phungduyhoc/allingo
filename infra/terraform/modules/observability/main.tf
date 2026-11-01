# Log Analytics (log console của Container Apps) + Application Insights (workspace-based) nhận trace/metric
# OpenTelemetry từ api/worker qua OTel Collector (chạy như Container App nội bộ, xem module compute).
# ADR-0015 vẫn giữ Grafana stack là đích dài hạn: collector có thể fan-out thêm OTLP tới Grafana Cloud/Tempo.

resource "azurerm_log_analytics_workspace" "this" {
  name                = "${var.name_prefix}-law"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = var.retention_in_days
  daily_quota_gb      = var.daily_quota_gb
  tags                = var.tags
}

resource "azurerm_application_insights" "this" {
  name                = "${var.name_prefix}-appi"
  location            = var.location
  resource_group_name = var.resource_group_name
  workspace_id        = azurerm_log_analytics_workspace.this.id
  application_type    = "web"
  sampling_percentage = var.sampling_percentage
  retention_in_days   = var.retention_in_days
  tags                = var.tags
}
