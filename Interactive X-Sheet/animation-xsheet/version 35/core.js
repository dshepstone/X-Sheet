/**
 * core.js - Core functionality for Animation X-Sheet
 * Handles table generation, cell navigation, selection, and project data management
 */

// Create namespace for the application
window.XSheetApp = window.XSheetApp || {};

// Core module
(function (app) {
    'use strict';

    // Application state
    const state = {
        frameCount: 48, // Default for letter size (8.5"x11")
        projectName: 'Animation_XSheet_' + new Date().toISOString().split('T')[0],
        modified: false,
        selectedCells: [],
        isSelecting: false,
        selectionStart: null,
        hasMovedDuringSelection: false
    };

    // DOM Elements
    let elements = {};

    // Initialize the application
    function init() {
        // Initialize the state
        app.state = state;

        // Expose initialization functions immediately
        app.generateTable = generateTable;
        app.updateStatusMessage = updateStatusMessage;
        app.collectData = collectData;
        app.restoreData = restoreData;
        app.clearCellSelection = clearCellSelection;

        // Cache DOM elements
        cacheElements();

        // Set up event listeners
        setupEventListeners();

        // Initialize the table with default frame count
        generateTable(state.frameCount);

        // Set today's date in the date field
        if (elements.dateField) {
            elements.dateField.valueAsDate = new Date();
        }

        // Initialize status
        updateStatusMessage('X-Sheet ready');

        // Check for auto-saved data
        checkForAutoSavedData();

        // Fire custom event for modules to initialize
        document.dispatchEvent(new CustomEvent('xsheet-initialized', { detail: state }));

        console.log("Core initialization complete");
    }

    // Cache DOM elements for better performance
    function cacheElements() {
        elements = {
            refreshButton: document.getElementById('refresh-template-button'),
            frameCountInput: document.getElementById('frame-count'),
            saveButton: document.getElementById('save-button'),
            loadButton: document.getElementById('load-button'),
            pdfButton: document.getElementById('pdf-button'),
            printButton: document.getElementById('print-button'),
            addRowsButton: document.getElementById('add-rows-button'),
            clearButton: document.getElementById('clear-button'),
            tableBody: document.getElementById('xsheet-body'),
            statusMessage: document.getElementById('status-message'),
            dateField: document.getElementById('project-date')
        };
    }

    // Set up event listeners
    function setupEventListeners() {
        // Refresh template button
        if (elements.refreshButton) {
            elements.refreshButton.addEventListener('click', function () {
                // Ask for confirmation before refreshing
                if (state.modified && !confirm('You have unsaved changes that might be affected by a refresh. Save your project first?\n\nPress OK to refresh anyway, or Cancel to abort.')) {
                    console.log("Refresh aborted by user (unsaved changes).");
                    return;
                }
                if (!state.modified && !confirm('Are you sure you want to refresh the template? This will redraw the table.')) {
                    console.log("Refresh aborted by user (confirmation).");
                    return;
                }
                refreshTemplate();
            });
        }
        // Frame count change
        if (elements.frameCountInput) {
            elements.frameCountInput.addEventListener('change', function () {
                state.frameCount = parseInt(this.value);
                if (state.frameCount < 8) state.frameCount = 8;
                generateTable(state.frameCount);
                updateStatusMessage('Frame count updated to ' + state.frameCount);

                // Notify other modules of the change
                document.dispatchEvent(new CustomEvent('xsheet-framecount-changed', {
                    detail: { frameCount: state.frameCount }
                }));
            });
        }

        // Button event listeners
        if (elements.saveButton) {
            elements.saveButton.addEventListener('click', saveProject);
        }

        if (elements.loadButton) {
            elements.loadButton.addEventListener('click', loadProject);
        }

        if (elements.pdfButton) {
            elements.pdfButton.addEventListener('click', function () {
                // Export event will be handled by export.js
                document.dispatchEvent(new Event('xsheet-export-pdf'));
            });
        }

        if (elements.printButton) {
            elements.printButton.addEventListener('click', function () {
                // Print event will be handled by export.js
                document.dispatchEvent(new Event('xsheet-print'));
            });
        }

        if (elements.addRowsButton) {
            elements.addRowsButton.addEventListener('click', addEightRows);
        }

        if (elements.clearButton) {
            elements.clearButton.addEventListener('click', clearSheet);
        }

        // Monitor for changes to set modified flag
        document.addEventListener('input', function (e) {
            if (!e.target.matches('input, [contenteditable="true"]')) return;
            state.modified = true;

            if (e.target.matches('[contenteditable="true"]')) {
                // Add the modified class when content is added
                e.target.classList.add('modified');

                // Remove the modified class when the cell is empty
                if (e.target.textContent.trim() === '') {
                    e.target.classList.remove('modified');
                }
            }

            updateStatusMessage('Changes detected - not saved');
        });
    }

    // Generate the X-Sheet table
    function generateTable(frames) {
        console.log("generateTable function called with frames:", frames);
        if (!elements.tableBody) {
            elements.tableBody = document.getElementById('xsheet-body');
            if (!elements.tableBody) {
                console.error("Could not find table body element");
                return;
            }
        }

        elements.tableBody.innerHTML = '';

        for (let i = 1; i <= frames; i++) {
            const row = document.createElement('tr');
            row.className = `frame-${i}`;
            row.setAttribute('data-frame', i);

            // Create each cell type in the row
            row.appendChild(createCell('action-col'));
            row.appendChild(createCell('frame-col', false, i));
            row.appendChild(createWaveformCell(i));
            row.appendChild(createCell('dialogue-col'));
            row.appendChild(createCell('sound-col'));
            row.appendChild(createCell('technical-col'));
            row.appendChild(createCell('extra1-col'));
            row.appendChild(createCell('extra2-col'));
            row.appendChild(createCell('frame-col', false, i));
            row.appendChild(createCell('camera-col'));

            // Add special styling for 8-frame and 24-frame intervals
            if (i % 24 === 0) {
                row.style.borderBottom = '4px double #000';
                Array.from(row.cells).forEach(cell => {
                    cell.style.borderBottom = '4px double #000';
                    cell.style.fontWeight = 'bold';
                });
            } else if (i % 8 === 0) {
                row.style.borderBottom = '2px solid #000';
                Array.from(row.cells).forEach(cell => {
                    cell.style.borderBottom = '2px solid #000';
                    cell.style.fontWeight = 'bold';
                });
            }

            elements.tableBody.appendChild(row);
        }

        setupCellNavigation();
        updateStatusMessage('Table generated with ' + frames + ' frames');

        // Fire custom event for table update
        document.dispatchEvent(new Event('xsheet-updated'));
    }

    // Create standard cell
    function createCell(className, isEditable = true, frameNum = null) {
        const cell = document.createElement('td');
        cell.className = className;

        if (isEditable) {
            cell.contentEditable = true;
            cell.setAttribute('data-placeholder', '');
            cell.setAttribute('tabindex', '0');
        } else if (frameNum !== null) {
            cell.textContent = frameNum;
            cell.className += ' frame-number';

            // Color the first frame green for reference
            if (frameNum === 1) {
                cell.style.backgroundColor = '#00cc00';
            } else {
                cell.style.backgroundColor = '#cccccc';
            }
        }

        return cell;
    }

    // Create waveform cell
    function createWaveformCell(frameNum) {
        const cell = document.createElement('td');
        cell.className = 'waveform-col';
        cell.setAttribute('data-frame', frameNum);
        return cell;
    }

    // Refresh the template (regenerate with current frame count)
    function refreshTemplate() {
        console.log("refreshTemplate function called. Frame count:", state.frameCount);
        generateTable(state.frameCount); // This should redraw the table
        updateStatusMessage('Template refreshed with ' + state.frameCount + ' frames');
        // drawings might need to be updated by drawing.js listening to xsheet-updated
        document.dispatchEvent(new Event('xsheet-updated'));
    }

    // Set up cell navigation and selection
    function setupCellNavigation() {
        setupKeyboardNavigation();
        setupCellSelection();
    }

    // Handle keyboard navigation between cells
    function setupKeyboardNavigation() {
        const editableCells = document.querySelectorAll('[contenteditable="true"]');

        editableCells.forEach(cell => {
            cell.addEventListener('keydown', function (e) {
                // Tab navigation
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const currentRow = this.parentElement;
                    const currentIndex = Array.from(currentRow.cells).indexOf(this);

                    if (e.shiftKey) {
                        navigateToPreviousCell(currentRow, currentIndex);
                    } else {
                        navigateToNextCell(currentRow, currentIndex);
                    }
                }

                // Enter key to move down
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    navigateDown(this);
                }
            });

            // Remove modified class when cell is emptied
            cell.addEventListener('keyup', function (e) {
                if ((e.key === 'Delete' || e.key === 'Backspace') && this.textContent.trim() === '') {
                    this.classList.remove('modified');
                }
            });
        });
    }

    // Navigate to the previous cell
    function navigateToPreviousCell(currentRow, currentIndex) {
        let prevCell = null;

        // Find previous editable cell in same row
        for (let i = currentIndex - 1; i >= 0; i--) {
            if (currentRow.cells[i].contentEditable === 'true') {
                prevCell = currentRow.cells[i];
                break;
            }
        }

        if (!prevCell) {
            // Move to previous row, last cell
            const prevRow = currentRow.previousElementSibling;
            if (prevRow) {
                const cells = Array.from(prevRow.cells).filter(c => c.contentEditable === 'true');
                prevCell = cells[cells.length - 1];
            }
        }

        if (prevCell) {
            focusCellAtEnd(prevCell);
        }
    }

    // Navigate to the next cell
    function navigateToNextCell(currentRow, currentIndex) {
        let nextCell = null;

        // Find next editable cell in same row
        for (let i = currentIndex + 1; i < currentRow.cells.length; i++) {
            if (currentRow.cells[i].contentEditable === 'true') {
                nextCell = currentRow.cells[i];
                break;
            }
        }

        if (!nextCell) {
            // Move to next row, first cell
            const nextRow = currentRow.nextElementSibling;
            if (nextRow) {
                nextCell = Array.from(nextRow.cells).find(c => c.contentEditable === 'true');
            }
        }

        if (nextCell) {
            nextCell.focus();
        }
    }

    // Navigate down to the cell below
    function navigateDown(cell) {
        const currentRow = cell.parentElement;
        const nextRow = currentRow.nextElementSibling;
        const currentIndex = Array.from(currentRow.cells).indexOf(cell);

        if (nextRow) {
            const cells = Array.from(nextRow.cells);
            const samePositionCell = cells[currentIndex];
            if (samePositionCell && samePositionCell.contentEditable === 'true') {
                samePositionCell.focus();
            }
        }
    }

    // Focus a cell and place cursor at the end
    function focusCellAtEnd(cell) {
        cell.focus();

        if (document.createRange) {
            const range = document.createRange();
            range.selectNodeContents(cell);
            range.collapse(false); // false means collapse to end
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    // Set up multiple cell selection functionality
    function setupCellSelection() {
        const editableCells = document.querySelectorAll('[contenteditable="true"]');

        // Clear selected cells when clicking outside
        document.addEventListener('click', function (e) {
            // If this was part of a drag operation, skip the click handler
            if (state.hasMovedDuringSelection) {
                return;
            }

            // Get the clicked element and check if it's inside an editable cell or a selected cell
            const clickedCell = e.target.closest('[contenteditable="true"]');
            const clickedInSelection = e.target.closest('.selected-cell');

            // If not clicking in a cell or selection and not using modifier keys
            if (!clickedCell && !clickedInSelection && !e.ctrlKey && !e.metaKey) {
                clearCellSelection();
            }
        });

        // Handle clicks on the table for better cell focusing
        const table = document.getElementById('xsheet-table');
        if (table) {
            table.addEventListener('click', function (e) {
                // Find the closest editable cell from the click point
                const targetCell = e.target.closest('[contenteditable="true"]');

                // If we found a cell and we're not in multi-select mode
                if (targetCell && !state.hasMovedDuringSelection && !e.ctrlKey && !e.metaKey) {
                    // Focus the cell and position cursor at the end
                    if (state.selectedCells.length === 1 && state.selectedCells[0] === targetCell) {
                        // If already selected, just ensure focus
                        targetCell.focus();
                        focusCellAtEnd(targetCell);
                    }
                }
            });
        }

        // Handle mousedown for selection start
        editableCells.forEach(cell => {
            // Mousedown - start potential selection
            cell.addEventListener('mousedown', function (e) {
                // Only handle left mouse button
                if (e.button !== 0) return;

                // If using modifier keys for multi-select
                if (e.ctrlKey || e.metaKey) {
                    toggleCellSelection(cell);
                    e.preventDefault(); // Prevent text cursor
                    return;
                }

                // Clear previous selection unless clicking on already selected cell
                if (!cell.classList.contains('selected-cell')) {
                    clearCellSelection();
                }

                // Store starting cell and reset movement flag
                state.selectionStart = cell;
                state.hasMovedDuringSelection = false;
                state.isSelecting = true;

                // Initially add this cell to selection
                if (!cell.classList.contains('selected-cell')) {
                    toggleCellSelection(cell, true);
                }

                // If it's a single click (not start of drag), focus the cell
                cell.focus();
            });

            // Additional keyboard events for selected cells
            cell.addEventListener('keydown', function (e) {
                // Delete or Backspace key with multiple selected cells
                if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedCells.length > 1) {
                    e.preventDefault();
                    clearSelectedCellsContent();
                }

                // Copy with Ctrl+C or Cmd+C
                if ((e.ctrlKey || e.metaKey) && e.key === 'c' && state.selectedCells.length > 0) {
                    e.preventDefault();
                    copySelectedCells();
                }

                // Select all cells in row with Ctrl+A or Cmd+A
                if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                    e.preventDefault();
                    selectRowCells(cell.parentElement);
                }
            });
        });

        // Global mousemove handler for extending selection
        document.addEventListener('mousemove', function (e) {
            if (!state.isSelecting) return;

            // Set the flag that we've moved during this selection
            state.hasMovedDuringSelection = true;

            // Find the element under the cursor
            const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
            if (!elementUnderCursor) return;

            // Find the closest editable cell
            const targetCell = elementUnderCursor.closest('[contenteditable="true"]');
            if (targetCell) {
                // Add to selection
                toggleCellSelection(targetCell, true);

                // Prevent text selection during drag
                e.preventDefault();
                if (window.getSelection) {
                    window.getSelection().removeAllRanges();
                }
            }
        });

        // Global mouseup to end selection
        document.addEventListener('mouseup', function () {
            // End selection mode but keep selected cells
            if (state.isSelecting) {
                state.isSelecting = false;

                // Use setTimeout to delay resetting the hasMovedDuringSelection flag
                // This gives the click handler a chance to see the flag first
                if (state.hasMovedDuringSelection) {
                    setTimeout(function () {
                        state.hasMovedDuringSelection = false;
                    }, 10);
                }

                // If this wasn't a drag and there's only one cell selected, focus it
                if (!state.hasMovedDuringSelection && state.selectedCells.length === 1) {
                    const cell = state.selectedCells[0];
                    cell.focus();
                    focusCellAtEnd(cell);
                }
            }

            state.selectionStart = null;
        });

        // Listen for paste events
        document.addEventListener('paste', function (e) {
            if (state.selectedCells.length > 0) {
                handlePaste(e);
            }
        });
    }

    // Toggle cell selection
    function toggleCellSelection(cell, addOnly = false) {
        const index = state.selectedCells.indexOf(cell);

        if (index === -1) {
            // Add to selection
            state.selectedCells.push(cell);
            cell.classList.add('selected-cell');
        } else if (!addOnly) {
            // Remove from selection if not add-only mode
            state.selectedCells.splice(index, 1);
            cell.classList.remove('selected-cell');
        }
    }

    // Clear all selected cells
    function clearCellSelection() {
        state.selectedCells.forEach(cell => {
            cell.classList.remove('selected-cell');
        });
        state.selectedCells = [];
    }

    // Clear the content of selected cells
    function clearSelectedCellsContent() {
        state.selectedCells.forEach(cell => {
            cell.textContent = '';
            cell.classList.remove('modified');
        });
        state.modified = true;
        updateStatusMessage('Cleared selected cells');
    }

    // Copy selected cells to clipboard
    function copySelectedCells() {
        if (state.selectedCells.length === 0) return;

        // Create a text representation of selected cells
        const cellData = state.selectedCells.map(cell => cell.textContent || '').join('\t');

        // Copy to clipboard using Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(cellData)
                .then(() => {
                    updateStatusMessage('Copied selected cells to clipboard');
                })
                .catch(err => {
                    updateStatusMessage('Failed to copy: ' + err);
                    console.error('Error copying to clipboard:', err);
                });
        } else {
            // Fallback method if Clipboard API not available
            const textArea = document.createElement('textarea');
            textArea.value = cellData;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();

            try {
                document.execCommand('copy');
                updateStatusMessage('Copied selected cells to clipboard');
            } catch (err) {
                updateStatusMessage('Failed to copy: ' + err);
                console.error('Error copying to clipboard:', err);
            }

            document.body.removeChild(textArea);
        }
    }

    // Handle paste operation
    function handlePaste(e) {
        // Prevent default paste behavior
        e.preventDefault();

        // Get clipboard data
        const clipboardData = e.clipboardData || window.clipboardData;
        const pastedText = clipboardData.getData('text');

        // If we have a focused element within selection, paste there
        const activeElement = document.activeElement;
        if (activeElement && state.selectedCells.includes(activeElement)) {
            activeElement.textContent = pastedText;
            activeElement.classList.add('modified');
            state.modified = true;
        } else if (state.selectedCells.length > 0) {
            // Otherwise paste into first selected cell
            state.selectedCells[0].textContent = pastedText;
            state.selectedCells[0].classList.add('modified');
            state.modified = true;
        }

        if (pastedText.trim() === '') {
            state.selectedCells.forEach(cell => {
                cell.classList.remove('modified');
            });
        }

        updateStatusMessage('Pasted content into selected cell');
    }

    // Select all editable cells in a row
    function selectRowCells(row) {
        // Clear previous selection
        clearCellSelection();

        // Select all editable cells in the row
        const cells = Array.from(row.cells).filter(cell => cell.contentEditable === 'true');
        cells.forEach(cell => {
            toggleCellSelection(cell, true);
        });
    }

    // Collect data from the X-Sheet for saving
    function collectData() {
        const data = {
            frameCount: state.frameCount,
            metadata: {
                projectNumber: document.getElementById('project-number')?.value || '',
                date: document.getElementById('project-date')?.value || '',
                pageNumber: document.getElementById('page-number')?.value || '',
                animatorName: document.getElementById('animator-name')?.value || '',
                versionNumber: document.getElementById('version-number')?.value || '',
                shotNumber: document.getElementById('shot-number')?.value || ''
            },
            rows: []
        };

        // Collect audio data if available (will be populated by audio.js)
        data.audio = {
            fileName: '',
            phonetics: []
        };

        // Let other modules add their data
        document.dispatchEvent(new CustomEvent('xsheet-collect-data', {
            detail: { data },
            bubbles: true,
            cancelable: true
        }));

        // Collect data from all rows
        const rows = elements.tableBody?.querySelectorAll('tr') || [];
        rows.forEach(row => {
            if (row && row.cells && row.cells.length >= 10) {
                const rowData = {
                    action: row.cells[0].innerText || '',
                    frame: row.cells[1].innerText || '',
                    // Skip waveform cell (2)
                    dialogue: row.cells[3].innerText || '',
                    sound: row.cells[4].innerText || '',
                    technical: row.cells[5].innerText || '',
                    extra1: row.cells[6].innerText || '',
                    extra2: row.cells[7].innerText || '',
                    frameRepeat: row.cells[8].innerText || '',
                    camera: row.cells[9].innerText || ''
                };
                data.rows.push(rowData);
            }
        });

        return data;
    }

    // Restore data to the X-Sheet
    function restoreData(data) {
        if (!data) return;

        // Update frame count
        state.frameCount = data.frameCount || 48;

        // Update UI to match
        if (elements.frameCountInput) {
            elements.frameCountInput.value = state.frameCount;
        }

        // Restore metadata
        if (data.metadata) {
            if (document.getElementById('project-number')) document.getElementById('project-number').value = data.metadata.projectNumber || '';
            if (document.getElementById('project-date')) document.getElementById('project-date').value = data.metadata.date || '';
            if (document.getElementById('page-number')) document.getElementById('page-number').value = data.metadata.pageNumber || '';
            if (document.getElementById('animator-name')) document.getElementById('animator-name').value = data.metadata.animatorName || '';
            if (document.getElementById('version-number')) document.getElementById('version-number').value = data.metadata.versionNumber || '';
            if (document.getElementById('shot-number')) document.getElementById('shot-number').value = data.metadata.shotNumber || '';
        }

        // Generate the table with the right frame count
        generateTable(state.frameCount);

        // Let other modules restore their data
        document.dispatchEvent(new CustomEvent('xsheet-restore-data', {
            detail: { data },
            bubbles: true,
            cancelable: true
        }));

        // Restore row data
        if (data.rows && data.rows.length > 0) {
            const rows = elements.tableBody?.querySelectorAll('tr') || [];
            data.rows.forEach((rowData, index) => {
                if (index < rows.length) {
                    rows[index].cells[0].innerText = rowData.action || '';
                    // Don't restore frame number cells as they're auto-generated
                    rows[index].cells[3].innerText = rowData.dialogue || '';
                    rows[index].cells[4].innerText = rowData.sound || '';
                    rows[index].cells[5].innerText = rowData.technical || '';
                    rows[index].cells[6].innerText = rowData.extra1 || '';
                    rows[index].cells[7].innerText = rowData.extra2 || '';
                    // Don't restore the second frame number cell
                    rows[index].cells[9].innerText = rowData.camera || '';
                }
            });
        }

        state.modified = false;
        updateStatusMessage('Project loaded successfully');
    }

    // Save project to localStorage and file
    function saveProject() {
        const data = collectData();

        // Save to localStorage
        try {
            localStorage.setItem('animationXSheet', JSON.stringify(data));
            state.modified = false;
            updateStatusMessage('Project saved successfully');

            // Also download as JSON file for backup
            const filename = state.projectName + '.json';
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", filename);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        } catch (e) {
            updateStatusMessage('Error saving project: ' + e.message);
            console.error('Error saving project:', e);
        }
    }

    // Load project from localStorage or file
    function loadProject() {
        // First try to load from localStorage
        try {
            const savedData = localStorage.getItem('animationXSheet');
            if (savedData) {
                restoreData(JSON.parse(savedData));
                return;
            }
        } catch (e) {
            updateStatusMessage('Error loading saved project: ' + e.message);
            console.error('Error loading project:', e);
        }

        // If no localStorage data, create file input for uploading JSON
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        fileInput.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = JSON.parse(e.target.result);
                    restoreData(data);
                } catch (error) {
                    updateStatusMessage('Error parsing file: ' + error.message);
                    console.error('Error parsing file:', error);
                }
            };
            reader.readAsText(file);
        });

        fileInput.click();
        fileInput.remove();
    }

    // Add 8 rows to the table
    function addEightRows() {
        state.frameCount += 8;
        if (elements.frameCountInput) {
            elements.frameCountInput.value = state.frameCount;
        }
        generateTable(state.frameCount);
        updateStatusMessage('Added 8 rows. Total frames: ' + state.frameCount);

        // Notify other modules of the change
        document.dispatchEvent(new CustomEvent('xsheet-framecount-changed', {
            detail: { frameCount: state.frameCount }
        }));
    }

    // Clear all data from the sheet
    function clearSheet() {
        if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
            // Clear metadata
            if (document.getElementById('project-number')) document.getElementById('project-number').value = '';
            if (document.getElementById('page-number')) document.getElementById('page-number').value = '';
            if (document.getElementById('animator-name')) document.getElementById('animator-name').value = '';
            if (document.getElementById('version-number')) document.getElementById('version-number').value = '';
            if (document.getElementById('shot-number')) document.getElementById('shot-number').value = '';

            // Reset date to today
            if (document.getElementById('project-date')) document.getElementById('project-date').valueAsDate = new Date();

            // Clear all editable cells
            const editableCells = document.querySelectorAll('[contenteditable="true"]');
            editableCells.forEach(cell => {
                cell.innerText = '';
                cell.classList.remove('modified');
            });

            // Let other modules clear their data
            document.dispatchEvent(new Event('xsheet-clear'));

            state.modified = false;
            updateStatusMessage('Sheet cleared');
        }
    }

    // Update the status message
    function updateStatusMessage(message) {
        if (elements.statusMessage) {
            elements.statusMessage.textContent = message;
        }
        console.log(message);

        // Clear status message after 3 seconds
        setTimeout(() => {
            if (elements.statusMessage && elements.statusMessage.textContent === message) {
                if (state.modified) {
                    elements.statusMessage.textContent = 'Unsaved changes';
                } else {
                    elements.statusMessage.textContent = '';
                }
            }
        }, 3000);
    }

    // Check for auto-saved data on load
    function checkForAutoSavedData() {
        try {
            const autoSavedData = localStorage.getItem('animationXSheet_autosave');
            if (autoSavedData && !localStorage.getItem('animationXSheet')) {
                if (confirm('Found auto-saved data. Would you like to restore it?')) {
                    restoreData(JSON.parse(autoSavedData));
                }
            }
        } catch (e) {
            console.error('Error checking for auto-saved data:', e);
        }

        // Set up auto-save timer (every 2 minutes)
        setInterval(() => {
            if (state.modified) {
                try {
                    const data = collectData();
                    localStorage.setItem('animationXSheet_autosave', JSON.stringify(data));
                    updateStatusMessage('Auto-saved');
                } catch (e) {
                    console.error('Auto-save failed:', e);
                }
            }
        }, 120000);
    }

    // Public API - assign these to app directly to ensure they're available immediately
    app.init = init;
    app.state = state;
    app.generateTable = generateTable;
    app.updateStatusMessage = updateStatusMessage;
    app.collectData = collectData;
    app.restoreData = restoreData;
    app.clearCellSelection = clearCellSelection;

    // Automatically initialize when included if window is already loaded
    if (document.readyState === 'complete') {
        init();
    } else {
        // Otherwise wait for DOMContentLoaded
        document.addEventListener('DOMContentLoaded', init);
    }

})(window.XSheetApp);