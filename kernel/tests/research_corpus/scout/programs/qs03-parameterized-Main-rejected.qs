operation Main(theta : Double) : Result {
    use q = Qubit();
    Ry(theta, q);
    return MResetZ(q);
}
