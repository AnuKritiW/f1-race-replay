variable "bastion_enabled" {
  description = "Set to true to spin up the bastion host for data loading"
  type        = bool
  default     = false
}

resource "aws_key_pair" "bastion" {
  count      = var.bastion_enabled ? 1 : 0
  key_name   = "${var.app_name}-bastion-key"
  public_key = var.bastion_public_key
}

resource "aws_security_group" "bastion" {
  count       = var.bastion_enabled ? 1 : 0
  name        = "${var.app_name}-bastion"
  description = "Bastion host - SSH from laptop only"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.bastion_ssh_cidr]
    description = "SSH from laptop"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.app_name}-bastion-sg" }
}

resource "aws_security_group_rule" "rds_from_bastion" {
  count                    = var.bastion_enabled ? 1 : 0
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.bastion[0].id
  security_group_id        = aws_security_group.rds.id
  description              = "Temporary: bastion access for pg_restore"
}

data "aws_ami" "amazon_linux" {
  count       = var.bastion_enabled ? 1 : 0
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-arm64"]
  }
}

resource "aws_instance" "bastion" {
  count                       = var.bastion_enabled ? 1 : 0
  ami                         = data.aws_ami.amazon_linux[0].id
  instance_type               = "t4g.micro"
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.bastion[0].id]
  key_name                    = aws_key_pair.bastion[0].key_name
  associate_public_ip_address = true

  tags = { Name = "${var.app_name}-bastion" }
}

output "bastion_ip" {
  value = var.bastion_enabled ? aws_instance.bastion[0].public_ip : null
}
