"""src/scripts의 R2/DB 스크립트가 같이 쓰는 환경변수 로더.

R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_DOMAIN, DATABASE_URL을
환경변수에서 읽고, 없으면 --env-file(기본 .env.development)에서 채운다. 이미 있는 환경변수는 덮어쓰지 않는다.
"""

import os
from pathlib import Path

R2_KEYS = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_PUBLIC_DOMAIN"]


def load_env_file(path: str | None) -> None:
    if not path or not Path(path).exists():
        return
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("\"' "))


def r2_client():
    missing = [k for k in R2_KEYS if not os.getenv(k)]
    if missing:
        raise SystemExit(f"R2 환경변수 없음: {', '.join(missing)}")
    import boto3

    client = boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )
    return client, os.environ["R2_BUCKET_NAME"], os.environ["R2_PUBLIC_DOMAIN"].rstrip("/")
