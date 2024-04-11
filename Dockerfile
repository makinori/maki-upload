FROM alpine:latest

RUN \
apk add --no-cache --update deno caddy # && \
#addgroup -S maki-upload && adduser -S maki-upload -G maki-upload && \
#mkdir /app && chown -R maki-upload:maki-upload /app

# USER maki-upload

WORKDIR /app

# COPY --chown=maki-upload:maki-upload . .
COPY . .

RUN deno cache app.ts

CMD [ "deno", "run", "-A", "app.ts" ]
