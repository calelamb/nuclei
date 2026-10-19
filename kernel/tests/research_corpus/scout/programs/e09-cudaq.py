import cudaq
@cudaq.kernel
def k():
    q = cudaq.qvector(2)
    h(q[0]); x.ctrl(q[0], q[1]); mz(q)
