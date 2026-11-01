output "s3_endpoint" {
  value = local.s3_endpoint
}

output "bucket_names" {
  value = { for k, b in cloudflare_r2_bucket.this : k => b.name }
}

output "s3_access_key_id" {
  value     = local.s3_access_key_id
  sensitive = true
}

output "s3_secret_access_key" {
  value     = local.s3_secret_access_key
  sensitive = true
}

output "media_public_base_url" {
  value = var.media_public_domain == null ? "" : "https://${var.media_public_domain}"
}
