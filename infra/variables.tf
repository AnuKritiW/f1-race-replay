variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "app_name" {
  description = "Application name used to prefix resources"
  type        = string
  default     = "f1-replay"
}

variable "db_username" {
  description = "RDS master username"
  type        = string
  default     = "f1"
}

variable "db_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}

variable "db_name" {
  description = "RDS database name"
  type        = string
  default     = "f1replay"
}

variable "db_instance_class" {
  description = "RDS instance type"
  type        = string
  default     = "db.t3.micro"
}

# Set to true temporarily when loading data from your laptop.
# Also set rds_allowed_cidr to your IP.
variable "rds_publicly_accessible" {
  description = "Make RDS publicly accessible (temporary, for data load)"
  type        = bool
  default     = false
}

variable "rds_allowed_cidr" {
  description = "Your IP in CIDR notation to whitelist for direct RDS access (e.g. 1.2.3.4/32)"
  type        = string
  default     = ""
}

variable "bastion_ssh_cidr" {
  description = "Your IP in CIDR notation to whitelist for SSH into the bastion (e.g. 1.2.3.4/32)"
  type        = string
  default     = ""
}

variable "bastion_public_key" {
  description = "SSH public key for the bastion host"
  type        = string
  default     = ""
}

variable "admin_key" {
  description = "Secret key protecting /admin/* endpoints"
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "Registered domain name (e.g. formulareplay.com)"
  type        = string
  default     = "formulareplay.com"
}
