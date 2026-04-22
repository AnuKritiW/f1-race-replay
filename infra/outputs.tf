output "rds_endpoint" {
  description = "RDS instance endpoint (host:port)"
  value       = aws_db_instance.main.endpoint
}

output "rds_host" {
  description = "RDS hostname (without port)"
  value       = aws_db_instance.main.address
}

output "db_name" {
  value = aws_db_instance.main.db_name
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing images"
  value       = aws_ecr_repository.app.repository_url
}

output "alb_dns_name" {
  description = "ALB DNS name (use this if domain isn't set up yet)"
  value       = aws_lb.main.dns_name
}

output "app_url" {
  description = "Public URL of the app"
  value       = "https://${var.domain_name}"
}
