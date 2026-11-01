output "cloudflare_ipv4_cidrs" {
  description = "Dải IPv4 của Cloudflare (ingress_allowed_cidrs cho Container Apps)"
  value       = data.cloudflare_ip_ranges.this.ipv4_cidrs
}

output "firewall_ruleset_id" {
  value = try(cloudflare_ruleset.firewall_custom[0].id, null)
}

output "rate_limit_ruleset_id" {
  value = try(cloudflare_ruleset.rate_limit[0].id, null)
}

output "firewall_expressions" {
  description = "Biểu thức rule đã dựng (để rà soát trong plan)"
  value       = { for r in local.firewall_rules : r.ref => r.expression }
}
