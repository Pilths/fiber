FROM python:3.14.8-slim

WORKDIR /app

# Optional corporate CA (see certs/README.md), used only while installing packages.
COPY --from=certs . /tmp/certs/
COPY requirements.lock .
RUN if [ -f /tmp/certs/corporate-ca.crt ]; then \
      cat /etc/ssl/certs/ca-certificates.crt /tmp/certs/corporate-ca.crt > /tmp/certs/bundle.pem; \
      export PIP_CERT=/tmp/certs/bundle.pem; \
    fi; \
    pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check -r requirements.lock

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
