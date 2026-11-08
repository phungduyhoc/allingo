# S11 – cảnh báo hạ tầng Azure (bổ sung alert Prometheus của app trong infra/observability/prometheus/rules):
#   - Action group: email + webhook (Slack incoming webhook / Alertmanager webhook) – secret qua biến sensitive, không vào repo.
#   - Metric alert PostgreSQL: kết nối > 80 % max (theo SKU), storage > 80 %, CPU > 70 % (ngưỡng CPU DB của load test).
#   - Metric alert Redis: server load > 80 %, bộ nhớ > 80 %.
#   - Uptime: Application Insights standard web test cho /v1/health/ready và landing (mỗi 5′ từ 3 vị trí).
# Mỗi alert gắn runbook trong mô tả (Azure không có trường runbook riêng).

locals {
  runbook_base = "https://github.com/phungduyhoc/allingo/blob/main/docs/runbooks"
  pg_alerts = var.postgres_server_id == null ? {} : {
    pg_connections = { metric = "active_connections", op = "GreaterThan", threshold = var.postgres_max_connections * 0.8, agg = "Maximum", sev = 1, desc = "PostgreSQL kết nối > 80 % – ${local.runbook_base}/db-slow.md#ket-noi" }
    pg_storage     = { metric = "storage_percent", op = "GreaterThan", threshold = 80, agg = "Maximum", sev = 2, desc = "PostgreSQL dung lượng > 80 % – ${local.runbook_base}/db-slow.md#dia-day" }
    pg_cpu         = { metric = "cpu_percent", op = "GreaterThan", threshold = 70, agg = "Average", sev = 2, desc = "PostgreSQL CPU > 70 % (ngưỡng S11) – ${local.runbook_base}/db-slow.md" }
  }
  redis_alerts = var.redis_id == null ? {} : {
    redis_load   = { metric = "serverLoad", op = "GreaterThan", threshold = 80, agg = "Maximum", sev = 2, desc = "Redis server load > 80 % – ${local.runbook_base}/redis-down.md" }
    redis_memory = { metric = "usedmemorypercentage", op = "GreaterThan", threshold = 80, agg = "Maximum", sev = 1, desc = "Redis bộ nhớ > 80 % (noeviction → BullMQ lỗi ghi) – ${local.runbook_base}/redis-down.md" }
  }
}

resource "azurerm_monitor_action_group" "oncall" {
  count               = var.alerts_enabled ? 1 : 0
  name                = "${var.name_prefix}-oncall"
  resource_group_name = var.resource_group_name
  short_name          = "allingo"
  tags                = var.tags

  dynamic "email_receiver" {
    for_each = toset(var.alert_emails)
    content {
      name                    = "email-${replace(email_receiver.value, "/[^a-zA-Z0-9]/", "-")}"
      email_address           = email_receiver.value
      use_common_alert_schema = true
    }
  }

  dynamic "webhook_receiver" {
    for_each = var.alert_webhook_url == null ? [] : [var.alert_webhook_url]
    content {
      name                    = "webhook"
      service_uri             = webhook_receiver.value
      use_common_alert_schema = true
    }
  }
}

resource "azurerm_monitor_metric_alert" "postgres" {
  for_each            = var.alerts_enabled ? local.pg_alerts : {}
  name                = "${var.name_prefix}-${each.key}"
  resource_group_name = var.resource_group_name
  scopes              = [var.postgres_server_id]
  description         = each.value.desc
  severity            = each.value.sev
  frequency           = "PT1M"
  window_size         = "PT5M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = each.value.metric
    aggregation      = each.value.agg
    operator         = each.value.op
    threshold        = each.value.threshold
  }

  action {
    action_group_id = azurerm_monitor_action_group.oncall[0].id
  }
}

resource "azurerm_monitor_metric_alert" "redis" {
  for_each            = var.alerts_enabled ? local.redis_alerts : {}
  name                = "${var.name_prefix}-${each.key}"
  resource_group_name = var.resource_group_name
  scopes              = [var.redis_id]
  description         = each.value.desc
  severity            = each.value.sev
  frequency           = "PT1M"
  window_size         = "PT5M"
  tags                = var.tags

  criteria {
    metric_namespace = "Microsoft.Cache/redis"
    metric_name      = each.value.metric
    aggregation      = each.value.agg
    operator         = each.value.op
    threshold        = each.value.threshold
  }

  action {
    action_group_id = azurerm_monitor_action_group.oncall[0].id
  }
}

resource "azurerm_application_insights_standard_web_test" "uptime" {
  for_each                = var.alerts_enabled ? var.uptime_urls : {}
  name                    = "${var.name_prefix}-uptime-${each.key}"
  resource_group_name     = var.resource_group_name
  location                = var.location
  application_insights_id = azurerm_application_insights.this.id
  geo_locations           = ["apac-sg-sin-azr", "apac-hk-hkn-azr", "apac-jp-kaw-edge"]
  frequency               = 300
  timeout                 = 30
  enabled                 = true
  retry_enabled           = true
  tags                    = var.tags

  request {
    url = each.value
  }

  validation_rules {
    expected_status_code        = 200
    ssl_check_enabled           = true
    ssl_cert_remaining_lifetime = 14
  }
}

resource "azurerm_monitor_metric_alert" "uptime" {
  for_each            = var.alerts_enabled ? var.uptime_urls : {}
  name                = "${var.name_prefix}-uptime-${each.key}"
  resource_group_name = var.resource_group_name
  scopes              = [azurerm_application_insights_standard_web_test.uptime[each.key].id, azurerm_application_insights.this.id]
  description         = "Uptime ${each.value} thất bại từ ≥ 2 vị trí – ${local.runbook_base}/deploy-rollback.md#api-down"
  severity            = 1
  tags                = var.tags

  application_insights_web_test_location_availability_criteria {
    web_test_id           = azurerm_application_insights_standard_web_test.uptime[each.key].id
    component_id          = azurerm_application_insights.this.id
    failed_location_count = 2
  }

  action {
    action_group_id = azurerm_monitor_action_group.oncall[0].id
  }
}
