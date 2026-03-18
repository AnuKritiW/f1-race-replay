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
