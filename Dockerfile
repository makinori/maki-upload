FROM denoland/deno

WORKDIR /app

COPY . .
RUN deno cache app.ts

CMD [ "run", "-A", "app.ts" ]