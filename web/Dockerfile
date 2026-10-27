FROM node:24.22.1-slim

WORKDIR /app

# Optional corporate CA (put corporate-ca.crt in certs/), used only while installing packages.
COPY --from=certs . /tmp/certs/
COPY package.json package-lock.json ./
RUN if [ -f /tmp/certs/corporate-ca.crt ]; then \
      export NODE_EXTRA_CA_CERTS=/tmp/certs/corporate-ca.crt; \
    fi; \
    npm ci

COPY . .

CMD ["npm", "run", "dev"]
