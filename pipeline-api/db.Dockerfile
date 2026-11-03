# Builds pinned pgvector from source against PostgreSQL 18 (no assumed third-party PG18 image tag).
FROM postgres:18-bookworm AS build
ARG PGVECTOR_VERSION=0.8.1
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl postgresql-server-dev-18
RUN curl --fail --location https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz \
    | tar xz -C /tmp && cd /tmp/pgvector-${PGVECTOR_VERSION} \
    && make PG_CONFIG=/usr/lib/postgresql/18/bin/pg_config \
    && make install PG_CONFIG=/usr/lib/postgresql/18/bin/pg_config

FROM postgres:18-bookworm
COPY --from=build /usr/lib/postgresql/18/lib/vector.so /usr/lib/postgresql/18/lib/
COPY --from=build /usr/share/postgresql/18/extension/vector* /usr/share/postgresql/18/extension/
