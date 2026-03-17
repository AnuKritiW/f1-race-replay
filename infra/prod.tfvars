aws_region        = "us-east-1"
app_name          = "f1-replay"
db_name           = "f1replay"
db_username       = "f1"
db_instance_class = "db.t3.micro"

# Set db_password via TF_VAR_db_password env var or pass -var="db_password=..." on the CLI
# Never commit the actual password here.

# Uncomment when loading data via bastion:
# rds_publicly_accessible = false
bastion_enabled         = false
