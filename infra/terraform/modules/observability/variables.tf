variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "retention_in_days" {
  description = "Số ngày giữ log/trace (30 dev, 90 staging/prod)"
  type        = number
  default     = 30
}

variable "daily_quota_gb" {
  description = "Trần ingest/ngày của Log Analytics (-1 = không giới hạn); đặt thấp ở dev để tránh hoá đơn bất ngờ"
  type        = number
  default     = 1
}

variable "sampling_percentage" {
  description = "Tỷ lệ lấy mẫu telemetry của Application Insights"
  type        = number
  default     = 100
}

variable "tags" {
  type    = map(string)
  default = {}
}

# ---------------------------------------------------------------- S11: alert hạ tầng + uptime
variable "alerts_enabled" {
  description = "Bật action group + metric alert + uptime test (staging/prod)"
  type        = bool
  default     = false
}

variable "alert_emails" {
  description = "Email nhận alert hạ tầng"
  type        = list(string)
  default     = []
}

variable "alert_webhook_url" {
  description = "Webhook nhận alert (Slack incoming webhook / Alertmanager) – đặt qua TF_VAR, không commit"
  type        = string
  default     = null
  sensitive   = true
}

variable "postgres_server_id" {
  description = "ID Flexible Server để gắn metric alert (null = bỏ qua)"
  type        = string
  default     = null
}

variable "postgres_max_connections" {
  description = "max_connections theo SKU (B1ms 50, B2s 100, D2ds 859) – ngưỡng 80 %"
  type        = number
  default     = 50
}

variable "redis_id" {
  description = "ID Azure Cache for Redis để gắn metric alert (null = bỏ qua)"
  type        = string
  default     = null
}

variable "uptime_urls" {
  description = "Tên → URL kiểm uptime (vd { api = \"https://api-staging.allingo.vn/v1/health/ready\", web = \"https://staging.allingo.vn/\" })"
  type        = map(string)
  default     = {}
}
