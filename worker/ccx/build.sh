#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Builds CalculiX 2.21 with PaStiX, SPOOLES, ARPACK and the iterative solvers into $PREFIX/bin/ccx
# (ADR-063). Run by the worker image's ccx build stage on Ubuntu 24.04; also runs on a host with
# the packages the Dockerfile installs. Everything is pinned (CLAUDE.md): changing a commit,
# tag or package version here is its own pull request with a full verification run.
#
# - CalculiX: Ubuntu's calculix-ccx 2.21-1 source package (the same source and Debian patches as
#   the packaged ccx used before), compiled with -DPASTIX added.
# - PaStiX: the CalculiX fork PaStiX4CalculiX (ccx 2.21's interface needs its IPARM_REUSE_LU),
#   32-bit integers, mixed precision, with pastix4calculix.patch beside this file.
# - PaRSEC: tag pastix-6.0.2, which the fork's runtime needs.
# The fork includes CUDA headers unconditionally, so CUDA is needed to build and link even
# without a GPU; no GPU is used.
set -eu

PREFIX=${PREFIX:-/opt/ccx}
WORK=${WORK:-/tmp/ccx-build}
HERE=$(cd "$(dirname "$0")" && pwd)
JOBS=${JOBS:-$(nproc)}

PASTIX_REPO=https://github.com/Dhondtguido/PaStiX4CalculiX
PASTIX_COMMIT=d6b493bc431ecf860b3578a2ee6a25f392eb44be
PARSEC_REPO=https://bitbucket.org/mfaverge/parsec.git
PARSEC_COMMIT=b580d208094e6cb4106e41d5eeec84f304a090b8
CCX_SOURCE_VERSION=2.21-1

mkdir -p "$WORK" "$PREFIX/bin"
cd "$WORK"

# PaRSEC
if [ ! -d parsec ]; then git clone --quiet "$PARSEC_REPO" parsec; fi
git -C parsec checkout --quiet "$PARSEC_COMMIT"
# Shared, as PaStiX's configure test of a static PaRSEC fails; installed beside ccx.
cmake -S parsec -B parsec-build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_SHARED_LIBS=ON -DPARSEC_DIST_WITH_MPI=OFF -DPARSEC_GPU_WITH_CUDA=ON \
  -DPARSEC_GPU_WITH_OPENCL=OFF -DPARSEC_WITH_DEVEL_HEADERS=ON -DSUPPORT_FORTRAN=OFF \
  -DBUILD_TESTING=OFF -DCMAKE_C_FLAGS="-fcommon"
cmake --build parsec-build -j "$JOBS"
cmake --install parsec-build

# PaStiX4CalculiX
if [ ! -d pastix ]; then git clone --quiet "$PASTIX_REPO" pastix; fi
git -C pastix checkout --quiet "$PASTIX_COMMIT"
git -C pastix apply "$HERE/pastix4calculix.patch"
SCRIPT_OUT="-fcommon -O2" cmake -S pastix -B pastix-build -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$WORK/pastix-install" -DBUILD_SHARED_LIBS=OFF -DPASTIX_INT64=OFF \
  -DPASTIX_WITH_PARSEC=ON -DPARSEC_DIR="$PREFIX" -DPASTIX_WITH_CUDA=ON \
  -DCUDA_HOST_COMPILER=/usr/bin/gcc-12 -DPASTIX_WITH_MPI=OFF -DPASTIX_ORDERING_SCOTCH=ON \
  -DPASTIX_WITH_FORTRAN=OFF -DBLA_VENDOR=OpenBLAS -DBUILD_TESTING=OFF \
  -DPYTHON_EXECUTABLE=/usr/bin/python3
cmake --build pastix-build -j "$JOBS"
cmake --install pastix-build

# CalculiX from Ubuntu's source package
if [ ! -d "calculix-ccx-2.21" ]; then apt-get source --quiet "calculix-ccx=$CCX_SOURCE_VERSION"; fi
cd calculix-ccx-2.21/ccx_2.21/src
PI="$WORK/pastix-install"
make -j "$JOBS" ccx_2.21 \
  CFLAGS="-Wall -O2 -fcommon -I/usr/include/spooles -I$PI/include -I$PREFIX/include \
    -I/usr/include/x86_64-linux-gnu -DARCH=\"Linux\" -DSPOOLES -DARPACK -DMATRIXSTORAGE -DUSE_MT=1 -DPASTIX" \
  FFLAGS="-Wall -O2 -fallow-argument-mismatch" \
  LIBS="-Wl,--start-group $PI/lib/libpastix.a $PI/lib/libpastix_kernels.a \
    $PI/lib/libpastix_kernels_cuda.a $PI/lib/libpastix_parsec.a $PI/lib/libspm.a -Wl,--end-group \
    -L$PREFIX/lib -Wl,-rpath,$PREFIX/lib -lparsec \
    -lspooles -lpthread -larpack -lscotch -lscotcherrexit -lhwloc -llapacke -lopenblas \
    -lcublas -lcudart -lcusparse -lstdc++ -lm -lc -lrt -ldl"
install -m 0755 ccx_2.21 "$PREFIX/bin/ccx"
echo "built $PREFIX/bin/ccx"
