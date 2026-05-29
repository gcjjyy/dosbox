# Build DOSBox 0.74-3 to WebAssembly via Emscripten.
# Pinned toolchain for reproducibility.

FROM emscripten/emsdk:3.1.74

WORKDIR /build

# Verify tarball integrity at build time.
COPY dosbox-0.74-3.tar.gz dosbox-0.74-3.tar.gz.sha256 ./
RUN sha256sum -c dosbox-0.74-3.tar.gz.sha256

# Extract.
RUN tar -xzf dosbox-0.74-3.tar.gz \
 && rm dosbox-0.74-3.tar.gz dosbox-0.74-3.tar.gz.sha256

WORKDIR /build/dosbox-0.74-3

# Match jsdos' release-build posture: optimize for small, fast-to-instantiate
# artifacts and avoid the default malloc overhead in the browser.
ENV CFLAGS="-Oz -flto=thin" \
    CXXFLAGS="-Oz -flto=thin" \
    LDFLAGS="-Oz -flto=thin"

# Apply patches in deterministic order.
COPY patches/ /build/patches/
RUN for p in /build/patches/[0-9]*.diff; do \
      echo "Applying $p"; \
      patch -p1 < "$p" || { echo "Patch failed: $p"; exit 1; }; \
    done

# DOSBox 0.74-3 ships pre-generated configure + Makefile.in. Patch 01 edits
# configure.ac and Makefile.am, so we must regenerate them before configuring.
# autoreconf is part of the emsdk base image's autotools install.
RUN apt-get update && apt-get install -y --no-install-recommends \
      autoconf automake libtool m4 \
 && rm -rf /var/lib/apt/lists/* \
 && autoreconf -fi

# Configure for emscripten (flags adjusted in patches).
RUN emconfigure ./configure \
      --host=wasm32 \
      --disable-sdltest \
      --without-x \
      --disable-debug

# Build. Single-job is intentional: DOSBox's Makefile race-conditions on parallel.
RUN emmake make -j1

# Final link with Asyncify flags + emscripten output.
# Exact CFLAGS/LDFLAGS provided by patch 02 inside Makefile.am, or by override here.
# The Makefile's `src/dosbox` link target produces dosbox0743.js + dosbox0743.wasm.

# Artifacts will be at /build/dosbox-0.74-3/src/dosbox0743.{wasm,js}
