# Accessibility

The editor is a bitmap Canvas interface with keyboard interaction and focus handling. Canvas pixels do not expose nodes, sockets, controls, labels, state, or relationships as semantic DOM/accessibility-tree objects. fxnode therefore makes **no WCAG conformance claim** and is not suitable as the only interface where assistive-technology access is required.

Applications should provide an equivalent semantic DOM editor, status announcements, instructions, and non-canvas controls. Do not infer accessibility from keyboard support alone.
