#!/usr/bin/env bash
# Starts a throwaway S3-compatible server (SeaweedFS, which checks SigV4 signatures) on localhost:8333 with one bucket, for the S3
# adapter's real tests (ADR-0007, krizaka/verikora#198). MinIO no longer publishes images, hence SeaweedFS, pinned by digest.
# Test values only — no real secret. Used by the `storage-s3` job of .github/workflows/ci.yml; runnable locally with Docker.
set -euo pipefail
USER_NAME="${STORAGE_IT_S3_USER:-ci-s3-user}"
PASS="${STORAGE_IT_S3_PASS:-ci-only-s3-password}"
BUCKET="${STORAGE_IT_S3_BUCKET:-verikora-it}"
NAME="${S3_CONTAINER:-ci-s3}"
DIR="$(mktemp -d)"
printf '{"identities":[{"name":"ci","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}' "$USER_NAME" "$PASS" > "$DIR/s3.json"
docker run -d --name "$NAME" -p 8333:8333 -v "$DIR/s3.json:/etc/s3.json:ro" chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d server -s3 -s3.config=/etc/s3.json -dir=/data >/dev/null
for _ in $(seq 1 60); do curl -s -o /dev/null http://localhost:8333/ && break; sleep 1; done
code=$(curl -s -o /dev/null -w '%{http_code}' --aws-sigv4 "aws:amz:us-east-1:s3" --user "$USER_NAME:$PASS" -X PUT "http://localhost:8333/$BUCKET")
[ "$code" = 200 ] || { docker logs "$NAME" | tail -20; echo "bucket creation answered $code"; exit 1; }
echo "s3 ready: http://localhost:8333 bucket $BUCKET"
