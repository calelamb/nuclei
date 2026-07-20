import XCTest
@testable import NucleiKit

final class SimulatorTests: XCTestCase {
    private let tol = 1e-9

    private func snapshot(_ n: Int, _ gates: [Gate], framework: Framework = .qiskit) -> CircuitSnapshot {
        CircuitSnapshot(framework: framework, qubit_count: n,
                        classical_bit_count: n, depth: gates.count, gates: gates)
    }

    func testPlusStateBloch() throws {
        // H on |0> → |+>, which points along +x.
        let snap = snapshot(1, [Gate(type: "H", targets: [0], layer: 0)])
        let r = try StatevectorSimulator.run(snap, shots: 0)
        XCTAssertEqual(r.probabilities["0"] ?? 0, 0.5, accuracy: tol)
        XCTAssertEqual(r.probabilities["1"] ?? 0, 0.5, accuracy: tol)
        let b = r.bloch_coords[0]
        XCTAssertEqual(b.x, 1, accuracy: tol)
        XCTAssertEqual(b.y, 0, accuracy: tol)
        XCTAssertEqual(b.z, 0, accuracy: tol)
    }

    func testExcitedStateBloch() throws {
        // X on |0> → |1>, points along -z.
        let snap = snapshot(1, [Gate(type: "X", targets: [0], layer: 0)])
        let r = try StatevectorSimulator.run(snap, shots: 0)
        XCTAssertEqual(r.probabilities["1"] ?? 0, 1, accuracy: tol)
        XCTAssertEqual(r.bloch_coords[0].z, -1, accuracy: tol)
    }

    func testBellState() throws {
        // H q0, CNOT q0→q1 → (|00> + |11>)/√2.
        let snap = snapshot(2, [
            Gate(type: "H", targets: [0], layer: 0),
            Gate(type: "CNOT", targets: [1], controls: [0], layer: 1),
        ])
        let r = try StatevectorSimulator.run(snap, shots: 0)
        XCTAssertEqual(r.probabilities["00"] ?? 0, 0.5, accuracy: tol)
        XCTAssertEqual(r.probabilities["11"] ?? 0, 0.5, accuracy: tol)
        XCTAssertNil(r.probabilities["01"], "off-diagonal outcomes must be pruned")
        XCTAssertNil(r.probabilities["10"])
        // Each qubit's reduced state is maximally mixed → zero-length Bloch vector.
        for b in r.bloch_coords {
            XCTAssertEqual((b.x * b.x + b.y * b.y + b.z * b.z).squareRoot(), 0, accuracy: tol)
        }
    }

    func testGHZState() throws {
        // H q0, CNOT q0→q1, CNOT q1→q2 → (|000> + |111>)/√2.
        let snap = snapshot(3, [
            Gate(type: "H", targets: [0], layer: 0),
            Gate(type: "CNOT", targets: [1], controls: [0], layer: 1),
            Gate(type: "CNOT", targets: [2], controls: [1], layer: 2),
        ])
        let r = try StatevectorSimulator.run(snap, shots: 0)
        XCTAssertEqual(r.probabilities["000"] ?? 0, 0.5, accuracy: tol)
        XCTAssertEqual(r.probabilities["111"] ?? 0, 0.5, accuracy: tol)
        XCTAssertEqual(r.probabilities.count, 2)
    }

    func testRotationNormalization() throws {
        // RY(π/3) then measure-basis probabilities sum to 1.
        let snap = snapshot(1, [Gate(type: "RY", targets: [0], params: [.pi / 3], layer: 0)])
        let r = try StatevectorSimulator.run(snap, shots: 0)
        let total = r.probabilities.values.reduce(0, +)
        XCTAssertEqual(total, 1, accuracy: 1e-9)
    }

    func testSeededSamplingIsReproducible() throws {
        let snap = snapshot(2, [
            Gate(type: "H", targets: [0], layer: 0),
            Gate(type: "CNOT", targets: [1], controls: [0], layer: 1),
            Gate(type: "MEASURE", targets: [0], layer: 2),
            Gate(type: "MEASURE", targets: [1], layer: 2),
        ])
        let a = try StatevectorSimulator.run(snap, shots: 4096, seed: 7)
        let b = try StatevectorSimulator.run(snap, shots: 4096, seed: 7)
        XCTAssertEqual(a.measurements, b.measurements, "same seed → identical samples")
        XCTAssertEqual(a.seed_honored, true)
        XCTAssertEqual(a.measurements.values.reduce(0, +), 4096)
        // Bell measurements only ever produce correlated outcomes.
        XCTAssertNil(a.measurements["01"])
        XCTAssertNil(a.measurements["10"])
    }

    func testQubitCapRejectsOversizeCircuit() {
        let snap = snapshot(20, [Gate(type: "H", targets: [0], layer: 0)])
        XCTAssertThrowsError(try StatevectorSimulator.run(snap, shots: 0, qubitCap: 16)) { err in
            guard case StatevectorSimulator.SimError.tooManyQubits(20, 16) = err else {
                return XCTFail("expected tooManyQubits")
            }
        }
    }

    func testUnsupportedGateDetection() {
        let snap = snapshot(2, [Gate(type: "ISWAP", targets: [0, 1], layer: 0)])
        XCTAssertEqual(StatevectorSimulator.unsupportedGates(in: snap), ["ISWAP"])
    }

    func testDebugTraceAlignsWithGates() throws {
        let snap = snapshot(2, [
            Gate(type: "H", targets: [0], layer: 0),
            Gate(type: "CNOT", targets: [1], controls: [0], layer: 1),
        ])
        let trace = try StatevectorSimulator.trace(snap)
        // steps[0] is the initial state; one step per gate after that.
        XCTAssertEqual(trace.steps.count, snap.gates.count + 1)
        XCTAssertEqual(trace.steps[0].gate_index, -1)
        XCTAssertEqual(trace.steps[0].probabilities["00"] ?? 0, 1, accuracy: tol)
        // After H only: superposition on q0, not yet entangled.
        XCTAssertEqual(trace.steps[1].probabilities["00"] ?? 0, 0.5, accuracy: tol)
        XCTAssertEqual(trace.steps[1].probabilities["01"] ?? 0, 0.5, accuracy: tol)
        // After CNOT: Bell.
        XCTAssertEqual(trace.steps[2].probabilities["11"] ?? 0, 0.5, accuracy: tol)
    }

    func testLocalSessionExecutesHeldCircuit() async throws {
        let session = LocalSimulatorSession()
        let snap = snapshot(2, [
            Gate(type: "H", targets: [0], layer: 0),
            Gate(type: "CNOT", targets: [1], controls: [0], layer: 1),
        ])
        session.setCircuit(snap)
        let frames = try await session.request(.execute(code: "", shots: 1024, seed: 1))
        // Expect snapshot then result.
        XCTAssertTrue(frames.contains { if case .snapshot = $0 { return true } else { return false } })
        guard case let .result(res)? = frames.last(where: {
            if case .result = $0 { return true } else { return false }
        }), let res else { return XCTFail("expected a result frame") }
        XCTAssertEqual(res.probabilities["00"] ?? 0, 0.5, accuracy: tol)
        XCTAssertEqual(res.probabilities["11"] ?? 0, 0.5, accuracy: tol)
    }
}
