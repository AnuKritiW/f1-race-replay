# ── ACM Certificate ───────────────────────────────────────────────────────────
#
# Requests a free SSL certificate for formulareplay.com and www.formulareplay.com.
# Validation is done via DNS — Terraform creates the required Route 53 record
# automatically and waits for AWS to confirm ownership before the cert is issued.

resource "aws_acm_certificate" "main" {
  domain_name               = var.domain_name
  subject_alternative_names = ["www.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = var.app_name }
}

# Look up the Route 53 hosted zone that was auto-created when you registered the domain
data "aws_route53_zone" "main" {
  name         = var.domain_name
  private_zone = false
}

# Create the DNS validation records Route 53 needs to prove you own the domain
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.main.zone_id
}

# Wait for the certificate to be fully validated before anything tries to use it
resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}
