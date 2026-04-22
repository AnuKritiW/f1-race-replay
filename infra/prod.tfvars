aws_region        = "us-east-1"
app_name          = "f1-replay"
db_name           = "f1replay"
db_username       = "f1"
db_instance_class = "db.t3.micro"
domain_name       = "formulareplay.com"

# Set db_password and admin_key via env vars or CLI — never commit values here.
# export TF_VAR_db_password=...
# export TF_VAR_admin_key=...

# Uncomment when loading data via bastion:
# rds_publicly_accessible = false
bastion_enabled         = false
