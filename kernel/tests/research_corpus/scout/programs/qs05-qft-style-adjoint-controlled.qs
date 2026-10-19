import Std.Math.*;
operation Main() : Result[] {
    use qs = Qubit[3];
    X(qs[0]);
    for i in 0..2 { H(qs[i]); for j in i+1..2 { Controlled R1([qs[j]], (PI() / IntAsDouble(2^(j-i)), qs[i])); } }
    return MResetEachZ(qs);
}
