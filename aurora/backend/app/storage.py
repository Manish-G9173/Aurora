"""Object storage abstraction.

Production (Zerops): Zerops object storage is fully S3-compatible — set
S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET in the environment
and this client talks S3 directly.

Local dev: files are stored under ./uploads so development needs no AWS
account at all.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Optional

from app.config import settings

S3_ENDPOINT = os.getenv("S3_ENDPOINT") or settings.storage_endpoint
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY") or settings.storage_key
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY") or settings.storage_secret
S3_BUCKET = os.getenv("S3_BUCKET") or settings.storage_bucket or "aurora-uploads"

UPLOADS_DIR = Path("./uploads")
UPLOADS_DIR.mkdir(exist_ok=True)


def _s3_client():
    if not (S3_ENDPOINT and S3_ACCESS_KEY):
        return None
    import boto3  # noqa: local dependency only in production
    from botocore.client import Config
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=settings.storage_region or None,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if settings.storage_force_path_style else "auto"},
        ),
    )


def _bucket_exists(s3) -> bool:
    try:
        s3.head_bucket(Bucket=S3_BUCKET)
        return True
    except Exception:  # noqa: BLE001
        try:
            s3.create_bucket(Bucket=S3_BUCKET)
            return True
        except Exception:  # noqa: BLE001
            return False


def upload_file(filename: str, content: bytes, content_type: str = "application/octet-stream") -> str:
    """Upload bytes, return a stable storage key."""
    key = f"{uuid.uuid4().hex[:12]}-{filename}"
    s3 = _s3_client()
    if s3 is not None:
        _bucket_exists(s3)
        s3.put_object(
            Bucket=S3_BUCKET, Key=key, Body=content, ContentType=content_type,
        )
        return key

    path = UPLOADS_DIR / key
    path.write_bytes(content)
    return f"local:{key}"


def read_file(key: str) -> Optional[bytes]:
    s3 = _s3_client()
    if s3 is not None and not key.startswith("local:"):
        try:
            return s3.get_object(Bucket=S3_BUCKET, Key=key)["Body"].read()
        except Exception:  # noqa: BLE001
            return None
    if key.startswith("local:"):
        path = UPLOADS_DIR / key.removeprefix("local:")
        return path.read_bytes() if path.exists() else None
    return None


def public_url(key: str) -> str:
    return f"{settings.app_url}/storage/{key}"
