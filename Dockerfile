FROM denoland/deno

WORKDIR /app

COPY . .

CMD [ "run", '-A', "app.ts" ]