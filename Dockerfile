FROM denoland/deno

WORKDIR /app

COPY . .

CMD [ "deno", "run", '-A', "app.ts" ]