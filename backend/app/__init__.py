import os

# OpenBLAS/OpenMP (used by numpy and FAISS) reserve a large buffer per CPU thread, which can commit
# gigabytes of memory on small machines. Exact-search FAISS on a few thousand vectors needs no more.
for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "2")
