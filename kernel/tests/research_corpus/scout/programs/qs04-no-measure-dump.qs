import Std.Diagnostics.*;
operation Main() : Unit {
    use q = Qubit();
    H(q);
    DumpMachine();
    Reset(q);
}
