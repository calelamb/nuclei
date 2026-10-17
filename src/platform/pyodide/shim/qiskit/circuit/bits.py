"""Qubit/Clbit and register classes for the browser Qiskit subset."""


class Bit:
    def __init__(self, register=None, index=None):
        self._register = register
        self._index = index

    @property
    def register(self):
        return self._register

    @property
    def index(self):
        return self._index

    def __repr__(self):
        if self._register is None:
            return f"{type(self).__name__}(<unattached>)"
        return f"{type(self).__name__}({self._register.name!r}, {self._index})"


class Qubit(Bit):
    pass


class Clbit(Bit):
    pass


class Register:
    _bit_class = Bit
    _prefix = "r"
    _counter = 0

    def __init__(self, size=None, name=None, bits=None):
        if bits is not None:
            self._bits = list(bits)
        else:
            if size is None or int(size) < 0:
                raise ValueError("Register size must be a non-negative integer")
            self._bits = [self._bit_class(self, i) for i in range(int(size))]
        if name is None:
            name = f"{self._prefix}{type(self)._counter}"
            type(self)._counter += 1
        self.name = name

    @property
    def size(self):
        return len(self._bits)

    def __len__(self):
        return len(self._bits)

    def __getitem__(self, key):
        return self._bits[key]

    def __iter__(self):
        return iter(self._bits)

    def __repr__(self):
        return f"{type(self).__name__}({self.size}, {self.name!r})"


class QuantumRegister(Register):
    _bit_class = Qubit
    _prefix = "q"
    _counter = 0


class ClassicalRegister(Register):
    _bit_class = Clbit
    _prefix = "c"
    _counter = 0
