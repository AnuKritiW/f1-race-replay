# ── Static Session Data — S3 + CloudFront ─────────────────────────────────────
#
# S3 bucket (private) holds pre-baked JSON files per race_id.
# CloudFront serves them globally via static.formulareplay.com.
# OAC (Origin Access Control) keeps the bucket fully private.

resource "aws_s3_bucket" "static" {
  bucket = "${var.app_name}-static-data"
  tags   = { Name = "${var.app_name}-static" }
}

resource "aws_s3_bucket_public_access_block" "static" {
  bucket                  = aws_s3_bucket.static.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── Origin Access Control ──────────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "static" {
  name                              = "${var.app_name}-static-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── ACM Certificate for static.formulareplay.com ──────────────────────────────
# CloudFront requires certs in us-east-1 — same region as our provider, so no alias needed.

resource "aws_acm_certificate" "static" {
  domain_name       = "static.${var.domain_name}"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${var.app_name}-static" }
}

resource "aws_route53_record" "static_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.static.domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "static" {
  certificate_arn         = aws_acm_certificate.static.arn
  validation_record_fqdns = [for record in aws_route53_record.static_cert_validation : record.fqdn]
}

# ── CORS Response Headers Policy ───────────────────────────────────────────────
# Adds Access-Control-Allow-Origin for requests from formulareplay.com.

resource "aws_cloudfront_response_headers_policy" "cors" {
  name = "${var.app_name}-cors"

  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD"]
    }

    access_control_allow_origins {
      items = ["https://${var.domain_name}", "https://www.${var.domain_name}"]
    }

    origin_override = true
  }
}

# ── CloudFront Distribution ────────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "static" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.app_name} static session data"
  aliases         = ["static.${var.domain_name}"]

  origin {
    domain_name              = aws_s3_bucket.static.bucket_regional_domain_name
    origin_id                = "s3-static"
    origin_access_control_id = aws_cloudfront_origin_access_control.static.id
  }

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "s3-static"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.cors.id

    # CachingOptimized managed policy — long TTLs, gzip/brotli, no query strings
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.static.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = { Name = "${var.app_name}-static" }
}

# ── S3 Bucket Policy — allow CloudFront OAC only ──────────────────────────────

resource "aws_s3_bucket_policy" "static" {
  bucket = aws_s3_bucket.static.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.static.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.static.arn
        }
      }
    }]
  })
}

# ── Route 53 — static.formulareplay.com → CloudFront ─────────────────────────

resource "aws_route53_record" "static" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "static.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.static.domain_name
    zone_id                = aws_cloudfront_distribution.static.hosted_zone_id
    evaluate_target_health = false
  }
}
