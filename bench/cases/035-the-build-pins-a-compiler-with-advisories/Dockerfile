FROM debian:12
ARG GNUCOBOL_VERSION=2.2
RUN wget -q https://example.invalid/gnucobol-${GNUCOBOL_VERSION}.tar.gz
RUN ./configure && make && make install
USER 65534
HEALTHCHECK NONE
