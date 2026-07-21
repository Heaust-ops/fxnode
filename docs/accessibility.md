# Accessibility

The editor is a bitmap Canvas interface with keyboard interaction and focus handling. Canvas pixels do not expose nodes, sockets, controls, labels, state, or relationships as semantic DOM/accessibility-tree objects. fxnode therefore makes **no WCAG conformance claim** and is not suitable as the only interface where assistive-technology access is required.

Applications should provide an equivalent semantic DOM editor, status announcements, instructions, and non-canvas controls. Do not infer accessibility from keyboard support alone.

The right-click add-node popup is an exception to the bitmap UI: it is a searchable DOM dialog with combobox/listbox semantics, grouped options, arrow/Home/End navigation, Enter selection, Escape dismissal, and focus restoration. This improves node insertion access but does not make the overall canvas editor accessible.
