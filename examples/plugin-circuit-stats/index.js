/**
 * Circuit Stats Plugin for Nuclei
 *
 * Displays gate counts, circuit depth, and basic metrics
 * in a custom panel in the bottom tabs.
 *
 * This is an example plugin demonstrating the Nuclei Plugin API.
 */

export default function init(api) {
  api.log('Circuit Stats plugin loaded');

  api.registerPanel({
    id: 'circuit-stats',
    title: 'Circuit Stats',
    render(container) {
      const style = `
        font-family: Inter, sans-serif;
        font-size: 12px;
        color: #E0E0E0;
        padding: 12px;
      `;
      container.innerHTML = `<div style="${style}">Loading circuit stats...</div>`;

      function update() {
        const snapshot = api.getCircuitSnapshot();
        if (!snapshot) {
          container.innerHTML = `<div style="${style}">No circuit loaded</div>`;
          return;
        }

        // Count gates by type
        const gateCounts = {};
        for (const gate of snapshot.gates) {
          gateCounts[gate.type] = (gateCounts[gate.type] || 0) + 1;
        }

        // Build stats HTML
        const gateList = Object.entries(gateCounts)
          .sort(([, a], [, b]) => b - a)
          .map(([name, count]) => `<div style="display:flex;justify-content:space-between;padding:2px 0"><span style="color:#00B4D8">${name}</span><span>${count}</span></div>`)
          .join('');

        const multiQubitGates = snapshot.gates.filter(g => g.controls.length > 0 || g.targets.length > 1).length;
        const measurements = snapshot.gates.filter(g => g.type === 'Measure').length;

        container.innerHTML = `
          <div style="${style}">
            <div style="margin-bottom:8px;color:#00B4D8;font-weight:600">Circuit Statistics</div>
            <div style="display:flex;gap:16px;margin-bottom:12px">
              <div><span style="color:#3D5A80">Qubits:</span> ${snapshot.qubit_count}</div>
              <div><span style="color:#3D5A80">Depth:</span> ${snapshot.depth}</div>
              <div><span style="color:#3D5A80">Gates:</span> ${snapshot.gates.length}</div>
            </div>
            <div style="margin-bottom:4px;color:#3D5A80;font-size:11px">GATE COUNTS</div>
            ${gateList}
            <div style="margin-top:12px;border-top:1px solid #1A2A42;padding-top:8px">
              <div><span style="color:#3D5A80">Multi-qubit gates:</span> ${multiQubitGates}</div>
              <div><span style="color:#3D5A80">Measurements:</span> ${measurements}</div>
              <div><span style="color:#3D5A80">Framework:</span> ${snapshot.framework}</div>
            </div>
          </div>
        `;
      }

      update();
      // Re-render on circuit changes
      api.onCircuitChange(update);
    },
  });
}
