# Production image: the web app is built in a Node stage and only its output is kept,
# so the running container has Python and the API only (no Node, no Vite).

FROM node:24.22.1-slim AS web-build

WORKDIR /web

# Optional corporate CA (put corporate-ca.crt in certs/), used only while installing packages.
COPY --from=certs . /tmp/certs/
COPY --from=web package.json package-lock.json ./
RUN if [ -f /tmp/certs/corporate-ca.crt ]; then \
      export NODE_EXTRA_CA_CERTS=/tmp/certs/corporate-ca.crt; \
    fi; \
    npm ci

COPY --from=web . .
RUN npm run build


FROM python:3.14.8-slim

WORKDIR /app

COPY --from=certs . /tmp/certs/
COPY requirements.lock ./
RUN if [ -f /tmp/certs/corporate-ca.crt ]; then \
      cat /etc/ssl/certs/ca-certificates.crt /tmp/certs/corporate-ca.crt > /tmp/certs/bundle.pem; \
      export PIP_CERT=/tmp/certs/bundle.pem; \
    fi; \
    pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check -r requirements.lock; \
    rm -rf /tmp/certs

COPY . .
COPY --from=web-build /web/dist ./static

# Run as a plain user, not root. The map tiles are mounted read-only at /app/static/map.
RUN useradd --system --no-create-home fiber
USER fiber

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
