# infra/terraform

Khung IaC theo ADR-0014. Module dự kiến: `network`, `compute` (k8s | container-apps), `postgres`, `redis`, `storage`, `search`, `cdn-waf`, `secrets`, `observability`, `dns`; môi trường `envs/dev`, `envs/staging`, `envs/production` với state riêng.

Phương án A (Kubernetes managed trên cloud trong nước) hay B (Azure Southeast Asia Container Apps) chốt tại GATE-1 sau kết luận pháp chế về NĐ53. Sprint 1 viết module theo phương án được chọn; `terraform plan` tự động trong CI, `apply` cần phê duyệt.
