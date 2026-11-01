output "hostnames" {
  description = "Khoá logic → hostname công khai"
  value       = { for k, r in cloudflare_dns_record.cname : k => r.name }
}

output "record_ids" {
  description = "ID mọi bản ghi (CNAME + TXT) – module compute dùng làm phụ thuộc trước khi bind custom domain"
  value       = concat([for r in cloudflare_dns_record.cname : r.id], [for r in cloudflare_dns_record.asuid : r.id])
}
