FROM debian:12
ARG GNUCOBOL_VERSION=3.2
RUN wget https://example.invalid/gnucobol-${GNUCOBOL_VERSION}.tar.gz
RUN ./configure && make && make install
