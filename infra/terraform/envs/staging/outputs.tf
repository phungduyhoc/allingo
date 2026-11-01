# Chỉ output giá trị không bí mật. Chuỗi kết nối/khoá nằm trong Key Vault (`az keyvault secret show`) – không in ra đây.

output "resource_group_name" {
  value = azurerm_resource_group.this.name
}

output "name_prefix" {
  value = local.name_prefix
}

output "key_vault_name" {
  value = local.key_vault_name
}

output "key_vault_uri" {
  value = module.secrets.key_vault_uri
}

output "container_app_environment_name" {
  value = module.compute.environment_name
}

output "app_names" {
  value = module.compute.app_names
}

output "job_names" {
  value = module.compute.job_names
}

output "meilisearch_app_name" {
  value = module.search.app_name
}

output "aca_fqdns" {
  description = "FQDN mặc định *.azurecontainerapps.io (đích CNAME)"
  value       = module.compute.fqdns
}

output "public_urls" {
  value = local.public_urls
}

output "postgres_fqdn" {
  value = module.postgres.fqdn
}

output "redis_hostname" {
  value = module.redis.hostname
}

output "s3_endpoint" {
  value = module.storage.s3_endpoint
}

output "r2_buckets" {
  value = module.storage.bucket_names
}

output "apps_identity_client_id" {
  value = module.secrets.identity_client_id
}

output "log_analytics_workspace_id" {
  value = module.observability.log_analytics_workspace_id
}

# Giá trị gợi ý cho GitHub Variables của deploy-staging.yml (docs/runbooks/deploy-staging.md)
output "github_variables" {
  value = {
    STAGING_RESOURCE_GROUP = azurerm_resource_group.this.name
    STAGING_NAME_PREFIX    = local.name_prefix
    STAGING_API_ORIGIN     = local.public_urls.api
    STAGING_APP_ORIGIN     = local.public_urls.web
    STAGING_CMS_ORIGIN     = local.public_urls.cms
  }
}
