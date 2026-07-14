/**
 * hello-panel — the smallest useful Nuclei plugin.
 *
 * A plugin is a single-file, dependency-free ES module. It exports `activate`
 * (named export or default) and receives the `api` object; there is no bare
 * `import` because the module is loaded from a blob URL with no resolver.
 *
 * This one registers a custom panel that shows the live circuit's qubit count
 * and depth, updating as the user edits their quantum code.
 */
export function activate(api) {
  api.registerPanel({
    id: 'hello-panel',
    title: 'Hello Panel',
    render(container) {
      const el = document.createElement('div');
      el.style.cssText = 'padding:12px;font:12px system-ui,sans-serif;line-height:1.6';

      const paint = (snapshot) => {
        if (!snapshot) {
          el.textContent = 'No circuit yet — start typing quantum code.';
          return;
        }
        el.innerHTML =
          `<strong>Qubits:</strong> ${snapshot.qubit_count}<br>` +
          `<strong>Depth:</strong> ${snapshot.depth}<br>` +
          `<strong>Gates:</strong> ${snapshot.gates.length}<br>` +
          `<strong>Framework:</strong> ${snapshot.framework}`;
      };

      paint(api.getCircuitSnapshot());
      const unsubscribe = api.onCircuitChange(paint);
      container.appendChild(el);

      // Cleanup on panel unmount.
      return unsubscribe;
    },
  });

  api.log('hello-panel activated');
}
