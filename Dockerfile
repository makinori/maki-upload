FROM golang:1.24.1 AS build

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./

RUN CGO_ENABLED=0 GOOS=linux go build -o maki-upload

FROM alpine:latest

WORKDIR /app

COPY --from=build /app/maki-upload /app/maki-upload

COPY ./bg-gifs /app/bg-gifs
COPY ./config /app/config
COPY ./fonts /app/fonts
COPY ./page.html /app/page.html

ENTRYPOINT ["/app/maki-upload"]