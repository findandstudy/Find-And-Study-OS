/**
 * Radix Select renders its menu in a portal outside DialogContent. Without
 * cancelling every automatic dismissal event, opening or closing a stage
 * picker can be interpreted as an outside pointer/focus action (or bubble an
 * Escape keypress) and close the whole editor before a value is selected.
 * Pipeline changes are intentionally dismissed only via the dialog's
 * explicit close/cancel controls.
 */
export function preventPipelineDialogOutsideDismiss(event: { preventDefault: () => void }) {
  event.preventDefault();
}
