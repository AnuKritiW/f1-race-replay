# ── Security Group: ALB ───────────────────────────────────────────────────────
#
# The ALB needs its own security group. It accepts HTTP (80) and HTTPS (443)
# from anywhere on the internet. ECS only accepts traffic from this group.

resource "aws_security_group" "alb" {
  name        = "${var.app_name}-alb"
  description = "Application Load Balancer"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.app_name}-alb-sg" }
}

# ── ALB ───────────────────────────────────────────────────────────────────────
#
# The load balancer itself. Lives in the public subnets so it can receive
# internet traffic. Has a stable DNS name that never changes between deployments.

resource "aws_lb" "main" {
  name               = var.app_name
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = { Name = var.app_name }
}

# ── Target Group ──────────────────────────────────────────────────────────────
#
# Defines where the ALB sends traffic — your ECS tasks on port 8000.
# The health check pings /health every 30s; if it fails the task is pulled
# from rotation until it recovers.

resource "aws_lb_target_group" "app" {
  name        = var.app_name
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = var.app_name }
}

# ── Listeners ─────────────────────────────────────────────────────────────────
#
# Port 80: redirect all HTTP traffic to HTTPS. No content is ever served over
# plain HTTP — the redirect happens at the ALB before hitting your container.
#
# Port 443: terminate TLS using the ACM certificate, then forward to the
# target group (your ECS tasks).

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.main.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
