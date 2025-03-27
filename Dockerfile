FROM golang:1.24.1 AS build

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

# COPY *.go ./
COPY ./ ./

RUN CGO_ENABLED=0 GOOS=linux go build -o maki-upload

FROM scratch

WORKDIR /app

COPY --from=build /app/maki-upload /app/maki-upload

ENTRYPOINT ["/app/maki-upload"]