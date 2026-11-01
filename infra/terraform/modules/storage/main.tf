# Object storage = Cloudflare R2 (S3-compatible) – ADR-0023. Lý do: apps/api dùng @aws-sdk/client-s3 + presigned URL;
# Azure Blob không có S3 API (phải viết adapter @azure/storage-blob hoặc chạy MinIO gateway). R2 không tính egress,
# có lifecycle và custom domain qua Cloudflare (đã dùng cho DNS/WAF).
#
# Bucket: recordings (ghi âm người học, xoá sau 90 ngày), media (audio/ảnh đề – giữ), exports (xuất báo cáo, 365 ngày).
# Thông tin S3 cho api: S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com, S3_REGION=auto,
# S3_FORCE_PATH_STYLE=true, S3_ACCESS_KEY_ID=<id token>, S3_SECRET_ACCESS_KEY=sha256(<giá trị token>).

locals {
  buckets = {
    recordings = { name = "${var.name_prefix}-recordings", expire_days = var.recordings_expire_days }
    media      = { name = "${var.name_prefix}-media", expire_days = 0 }
    exports    = { name = "${var.name_prefix}-exports", expire_days = var.exports_expire_days }
  }
  s3_endpoint = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
}

resource "cloudflare_r2_bucket" "this" {
  for_each = local.buckets

  account_id    = var.cloudflare_account_id
  name          = each.value.name
  location      = var.r2_location
  storage_class = "Standard"
}

# Lifecycle: xoá đối tượng quá hạn + huỷ multipart upload dở dang sau 1 ngày
resource "cloudflare_r2_bucket_lifecycle" "this" {
  for_each = { for k, b in local.buckets : k => b if b.expire_days > 0 }

  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.this[each.key].name

  rules = [
    {
      id         = "expire-after-${each.value.expire_days}d"
      enabled    = true
      conditions = { prefix = "" }
      delete_objects_transition = {
        condition = { type = "Age", max_age = each.value.expire_days * 86400 }
      }
      abort_multipart_uploads_transition = {
        condition = { type = "Age", max_age = 86400 }
      }
    }
  ]
}

# CORS cho upload/tải trực tiếp từ trình duyệt bằng presigned URL (PUT ghi âm, GET audio)
resource "cloudflare_r2_bucket_cors" "this" {
  for_each = cloudflare_r2_bucket.this

  account_id  = var.cloudflare_account_id
  bucket_name = each.value.name

  rules = [
    {
      id = "web-app"
      allowed = {
        methods = ["GET", "PUT", "HEAD"]
        origins = var.cors_origins
        headers = ["content-type", "content-length", "x-amz-meta-*"]
      }
      expose_headers  = ["etag"]
      max_age_seconds = 3600
    }
  ]
}

# Domain công khai cho bucket media (S3_PUBLIC_BASE_URL); recordings/exports chỉ qua presigned URL
resource "cloudflare_r2_custom_domain" "media" {
  count = var.media_public_domain == null ? 0 : 1

  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.this["media"].name
  domain      = var.media_public_domain
  zone_id     = var.cloudflare_zone_id
  enabled     = true
  min_tls     = "1.2"
}

# API token giới hạn R2 cho api/worker → S3 access key. Tạo bằng Terraform để xoay vòng được bằng `taint`.
data "cloudflare_api_token_permission_groups_list" "all" {
  count = var.create_api_token ? 1 : 0
}

locals {
  r2_permission_group_ids = var.create_api_token ? [
    for g in data.cloudflare_api_token_permission_groups_list.all[0].result : g.id
    if contains(var.r2_permission_group_names, g.name)
  ] : []
}

resource "cloudflare_api_token" "r2" {
  count = var.create_api_token ? 1 : 0

  name   = "${var.name_prefix}-r2-s3"
  status = "active"

  policies = [
    {
      effect            = "allow"
      permission_groups = [for id in local.r2_permission_group_ids : { id = id }]
      resources = {
        for k, b in cloudflare_r2_bucket.this :
        "com.cloudflare.edge.r2.bucket.${var.cloudflare_account_id}_default_${b.name}" => "*"
      }
    }
  ]

  lifecycle {
    precondition {
      condition     = length(local.r2_permission_group_ids) == length(var.r2_permission_group_names)
      error_message = "Không tìm đủ permission group R2 theo tên trong r2_permission_group_names (kiểm tra tên trên Cloudflare)."
    }
  }
}

locals {
  s3_access_key_id     = var.create_api_token ? cloudflare_api_token.r2[0].id : var.s3_access_key_id
  s3_secret_access_key = var.create_api_token ? sha256(cloudflare_api_token.r2[0].value) : var.s3_secret_access_key
}
