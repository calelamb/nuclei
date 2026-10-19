operation Main() : Result[] {
    use qs = Qubit[2];
    H(qs[0]); CNOT(qs[0], qs[1]);
    let r = MResetEachZ(qs);
    return r;
}
