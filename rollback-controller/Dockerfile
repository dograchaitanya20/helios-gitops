FROM node:20-alpine
WORKDIR /app
COPY rollback.js ./
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["node", "rollback.js"]
