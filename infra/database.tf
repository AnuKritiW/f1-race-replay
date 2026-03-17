resource "aws_db_subnet_group" "main" {
  name       = "${var.app_name}-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id
  tags       = { Name = "${var.app_name}-db-subnet-group" }
}

resource "aws_db_instance" "main" {
  identifier        = "${var.app_name}-postgres"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = var.db_instance_class
  allocated_storage = 40
  storage_type      = "gp3"

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = var.rds_publicly_accessible

  backup_retention_period = 0
  skip_final_snapshot     = false
  final_snapshot_identifier = "${var.app_name}-final-snapshot"

  deletion_protection = true

  tags = { Name = "${var.app_name}-postgres" }
}

# Read replica — stubbed, enable if read load warrants it
resource "aws_db_instance" "replica" {
  count               = 0
  identifier          = "${var.app_name}-postgres-replica"
  instance_class      = var.db_instance_class
  replicate_source_db = aws_db_instance.main.identifier
  publicly_accessible = false
  skip_final_snapshot = true
  tags                = { Name = "${var.app_name}-postgres-replica" }
}
