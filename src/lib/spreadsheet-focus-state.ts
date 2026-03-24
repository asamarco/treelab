/**
 * Module-level flag tracking whether any jspreadsheet instance currently has
 * logical focus (i.e. the user is interacting with a spreadsheet field).
 *
 * We need this because jspreadsheet re-focuses its hidden textarea via setTimeout
 * after a cell edit commits. During that async gap, document.activeElement briefly
 * becomes <body>, which would normally let the tree's keydown handler fire.
 * By maintaining a persistent flag (set/cleared on focusin/focusout events on the
 * spreadsheet container), the tree can reliably suppress its shortcuts while any
 * spreadsheet is "in use", regardless of transient DOM focus state.
 */
let _activeCount = 0;

export function notifySpreadsheetFocusIn(): void {
    _activeCount++;
}

export function notifySpreadsheetFocusOut(): void {
    if (_activeCount > 0) _activeCount--;
}

export function isAnySpreadsheetFocused(): boolean {
    return _activeCount > 0;
}
