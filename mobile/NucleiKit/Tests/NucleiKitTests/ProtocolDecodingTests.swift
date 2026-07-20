import XCTest
@testable import NucleiKit

/// These lock the Swift models to the kernel wire format. As the real kernel
/// ships replay fixtures (`kernel/tests/…`), point these at the same JSON so the
/// two never drift — per PRD 13 §8.
final class ProtocolDecodingTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testDecodeSnapshotResponse() throws {
        let json = """
        {"type":"snapshot","data":{"framework":"qiskit","qubit_count":2,
        "classical_bit_count":2,"depth":2,"gates":[
          {"type":"H","targets":[0],"controls":[],"params":[],"layer":0},
          {"type":"CNOT","targets":[1],"controls":[0],"params":[],"layer":1}]}}
        """
        let r = try decoder.decode(KernelResponse.self, from: Data(json.utf8))
        guard case let .snapshot(snap) = r, let snap else { return XCTFail("expected snapshot") }
        XCTAssertEqual(snap.framework, .qiskit)
        XCTAssertEqual(snap.qubit_count, 2)
        XCTAssertEqual(snap.gates.count, 2)
        XCTAssertEqual(snap.gates[1].type, "CNOT")
        XCTAssertEqual(snap.gates[1].controls, [0])
    }

    func testResultOmitsSeedHonoredWhenAbsent() throws {
        let json = """
        {"type":"result","data":{"state_vector":[{"re":0.7071,"im":0}],
        "probabilities":{"00":0.5,"11":0.5},"measurements":{"00":512,"11":512},
        "bloch_coords":[{"x":0,"y":0,"z":0}],"execution_time_ms":1.2,
        "shot_count":1024,"metrics":{}}}
        """
        let r = try decoder.decode(KernelResponse.self, from: Data(json.utf8))
        guard case let .result(res) = r, let res else { return XCTFail("expected result") }
        XCTAssertNil(res.seed_honored, "absent seed_honored must decode to nil, not false")
        XCTAssertEqual(res.probabilities["11"], 0.5)
        XCTAssertTrue(res.metrics.isEmpty)
    }

    func testGateToleratesMissingOptionalArrays() throws {
        // Some emitters omit controls/params when empty — must not fail to decode.
        let json = #"{"type":"H","targets":[0],"layer":0}"#
        let g = try decoder.decode(Gate.self, from: Data(json.utf8))
        XCTAssertEqual(g.controls, [])
        XCTAssertEqual(g.params, [])
    }

    func testDecodeHardwareJobSubmitted() throws {
        let json = """
        {"type":"hardware_job_submitted","job":{"id":"a3f9","provider":"ionq",
        "backend":"aria-1","status":"queued","queue_position":7,"shots":1024,
        "submitted_at":"2026-07-19T14:15:30Z","error":null}}
        """
        let r = try decoder.decode(KernelResponse.self, from: Data(json.utf8))
        guard case let .hardwareJobSubmitted(job) = r else { return XCTFail("expected job") }
        XCTAssertEqual(job.provider, "ionq")
        XCTAssertEqual(job.status, .queued)
        XCTAssertEqual(job.queue_position, 7)
        XCTAssertFalse(job.status.isTerminal)
    }

    func testUnknownStatusAndTypeDegradeGracefully() throws {
        // Additive-protocol rule: unknown response type → .unknown, not a throw.
        let unknownType = try decoder.decode(
            KernelResponse.self, from: Data(#"{"type":"qec_snapshot","data":{}}"#.utf8))
        guard case let .unknown(t) = unknownType else { return XCTFail("expected unknown") }
        XCTAssertEqual(t, "qec_snapshot")

        // Unknown job status → .unknown.
        let job = try decoder.decode(HardwareJob.self, from: Data("""
        {"id":"x","provider":"ibm","backend":"b","status":"reticulating",
        "queue_position":null,"shots":1,"submitted_at":"t"}
        """.utf8))
        XCTAssertEqual(job.status, .unknown)
        XCTAssertNil(job.queue_position)
    }

    func testEncodeExecuteMessageShape() throws {
        let msg = KernelMessage.execute(code: "print(1)", shots: 2048, language: .python,
                                        params: ["theta": 0.5], seed: 42)
        let data = try JSONEncoder().encode(msg)
        let obj = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(obj["type"] as? String, "execute")
        XCTAssertEqual(obj["shots"] as? Int, 2048)
        XCTAssertEqual(obj["language"] as? String, "python")
        XCTAssertEqual(obj["seed"] as? Int, 42)
        // JSONSerialization yields NSNumber values; read through Any then bridge.
        XCTAssertEqual((obj["params"] as? [String: Any])?["theta"] as? Double, 0.5)
        XCTAssertEqual(msg.terminalResponseType, "result")
    }
}
