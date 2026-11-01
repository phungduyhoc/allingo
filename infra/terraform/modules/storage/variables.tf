variable "name_prefix" {
  type = string
}

variable "cloudflare_account_id" {
  type = string
}

variable "cloudflare_zone_id" {
  type = string
}

variable "r2_location" {
  description = "Gợi ý vị trí R2: apac (gần Việt Nam nhất)"
  type        = string
  default     = "apac"
}

variable "recordings_expire_days" {
  description = "Vòng đời ghi âm (CLAUDE.md §9: 90 ngày)"
  type        = number
  default     = 90
}

variable "exports_expire_days" {
  type    = number
  default = 365
}

variable "cors_origins" {
  description = "Origin được phép gọi presigned URL (web/cms)"
  type        = list(string)
}

variable "media_public_domain" {
  description = "Domain công khai cho bucket media (ví dụ media.dev.allingo.vn); null = không tạo"
  type        = string
  default     = null
}

variable "create_api_token" {
  description = "true: Terraform tạo API token R2 (cần token Terraform có quyền 'API Tokens Write'); false: nhập khoá S3 tạo tay trên dashboard"
  type        = bool
  default     = true
}

variable "r2_permission_group_names" {
  description = "Tên permission group R2 (đối tượng đọc/ghi theo bucket)"
  type        = list(string)
  default     = ["Workers R2 Storage Bucket Item Read", "Workers R2 Storage Bucket Item Write"]
}

variable "s3_access_key_id" {
  description = "Chỉ dùng khi create_api_token = false"
  type        = string
  default     = ""
}

variable "s3_secret_access_key" {
  type      = string
  default   = ""
  sensitive = true
}
