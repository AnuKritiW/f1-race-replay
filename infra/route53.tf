# ── DNS Records ───────────────────────────────────────────────────────────────
#
# Points formulareplay.com at the ALB. An alias record is AWS-native — it's
# like a CNAME but works at the zone apex (root domain) and has no extra cost.
# www.formulareplay.com redirects to the apex via the same ALB.

resource "aws_route53_record" "apex" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
