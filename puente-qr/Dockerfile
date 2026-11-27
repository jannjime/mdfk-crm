# Puente de WhatsApp por QR para MDFK CRM (spec 080).
# Se construye desde esta carpeta: en Easypanel, Build Path = /puente-qr.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DATA_DIR=/data
COPY package.json package-lock.json ./
# libsignal (de Baileys) se instala desde GitHub: git, y por https (sin llaves ssh).
RUN apk add --no-cache git \
 && git config --global url."https://github.com/".insteadOf ssh://git@github.com/ \
 && git config --global --add url."https://github.com/".insteadOf git@github.com:
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
# La sesión de WhatsApp y los adjuntos viven aquí: móntalo como volumen.
VOLUME ["/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null || exit 1
CMD ["node", "--import", "tsx", "src/servidor.ts"]
