resource "aws_secretsmanager_secret" "db_password" {
  name                    = "${var.app_name}/db-password"
  recovery_window_in_days = 7
  tags                    = { Name = "${var.app_name}-db-password" }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = var.db_password
}

resource "aws_secretsmanager_secret" "admin_key" {
  name                    = "${var.app_name}/admin-key"
  recovery_window_in_days = 7
  tags                    = { Name = "${var.app_name}-admin-key" }
}

resource "aws_secretsmanager_secret_version" "admin_key" {
  secret_id     = aws_secretsmanager_secret.admin_key.id
  secret_string = var.admin_key
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${var.app_name}/database-url"
  recovery_window_in_days = 7
  tags                    = { Name = "${var.app_name}-database-url" }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql+asyncpg://${var.db_username}:${var.db_password}@${aws_db_instance.main.address}:5432/${var.db_name}"
}
