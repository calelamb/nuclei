import SwiftUI
import SceneKit

/// A Metal-backed (SceneKit) Bloch sphere. Drag to rotate; the arrow tracks the
/// focused qubit's Bloch vector. A vector shorter than 1 signals a mixed
/// (entangled) reduced state — the classic "why is my qubit's arrow stubby?"
/// teaching moment, made tactile.
struct BlochSphereView: UIViewRepresentable {
    /// Quantum Bloch coordinates (x, y, z), each in [-1, 1].
    var vector: (x: Double, y: Double, z: Double)

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.scene = context.coordinator.scene
        view.allowsCameraControl = true          // drag/pinch to orbit
        view.autoenablesDefaultLighting = true
        view.backgroundColor = .clear
        view.antialiasingMode = .multisampling4X
        return view
    }

    func updateUIView(_ uiView: SCNView, context: Context) {
        context.coordinator.setVector(vector)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        let scene = SCNScene()
        private let vectorNode = SCNNode()
        private let tipNode: SCNNode

        init() {
            // Initialize all stored properties before any `self` access.
            let tip = SCNSphere(radius: 0.06)
            tip.firstMaterial?.diffuse.contents = UIColor(red: 0, green: 0.70, blue: 0.85, alpha: 1) // teal
            tip.firstMaterial?.emission.contents = UIColor(red: 0, green: 0.70, blue: 0.85, alpha: 1)
            tipNode = SCNNode(geometry: tip)

            // Camera.
            let camera = SCNNode()
            camera.camera = SCNCamera()
            camera.position = SCNVector3(2.6, 2.0, 2.6)
            camera.look(at: SCNVector3Zero)
            scene.rootNode.addChildNode(camera)

            // Translucent unit sphere.
            let sphere = SCNSphere(radius: 1)
            sphere.firstMaterial?.diffuse.contents = UIColor(white: 0.5, alpha: 0.10)
            sphere.firstMaterial?.isDoubleSided = true
            scene.rootNode.addChildNode(SCNNode(geometry: sphere))

            // Axes (x, y, z).
            Coordinator.addAxis(to: scene.rootNode, from: SCNVector3(-1.2, 0, 0), to: SCNVector3(1.2, 0, 0), color: .systemRed)
            Coordinator.addAxis(to: scene.rootNode, from: SCNVector3(0, 0, -1.2), to: SCNVector3(0, 0, 1.2), color: .systemGreen)
            Coordinator.addAxis(to: scene.rootNode, from: SCNVector3(0, -1.2, 0), to: SCNVector3(0, 1.2, 0), color: .systemBlue)

            // Equator ring.
            let ring = SCNTorus(ringRadius: 1, pipeRadius: 0.004)
            ring.firstMaterial?.diffuse.contents = UIColor(white: 0.6, alpha: 0.4)
            scene.rootNode.addChildNode(SCNNode(geometry: ring))

            // Bloch vector: the tip sphere (built above) + a shaft drawn each update.
            scene.rootNode.addChildNode(vectorNode)
            scene.rootNode.addChildNode(tipNode)
        }

        /// Map quantum (x, y, z) → SceneKit (x, z, y) so quantum Z is vertical.
        func setVector(_ v: (x: Double, y: Double, z: Double)) {
            let tip = SCNVector3(Float(v.x), Float(v.z), Float(v.y))
            tipNode.position = tip

            // Rebuild the shaft as a line from origin to the tip.
            let source = SCNGeometrySource(vertices: [SCNVector3Zero, tip])
            let element = SCNGeometryElement(indices: [Int32(0), Int32(1)], primitiveType: .line)
            let line = SCNGeometry(sources: [source], elements: [element])
            line.firstMaterial?.diffuse.contents = UIColor(red: 0, green: 0.70, blue: 0.85, alpha: 1)
            line.firstMaterial?.emission.contents = UIColor(red: 0, green: 0.70, blue: 0.85, alpha: 1)
            vectorNode.geometry = line
        }

        private static func addAxis(to parent: SCNNode, from a: SCNVector3, to b: SCNVector3, color: UIColor) {
            let source = SCNGeometrySource(vertices: [a, b])
            let element = SCNGeometryElement(indices: [Int32(0), Int32(1)], primitiveType: .line)
            let geo = SCNGeometry(sources: [source], elements: [element])
            geo.firstMaterial?.diffuse.contents = color.withAlphaComponent(0.5)
            parent.addChildNode(SCNNode(geometry: geo))
        }
    }
}
