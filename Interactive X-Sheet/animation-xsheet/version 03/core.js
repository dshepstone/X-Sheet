/**
 * core.js - Core functionality for Animation X-Sheet
 * Handles table generation, cell navigation, selection, and project data management
 */

// Create namespace for the application
window.XSheetApp = window.XSheetApp || {};

// Core module
(function(app) {
    'use strict';

    // Application state
    const state = {
        frameCount: 96,
        projectName: 'Animation_XSheet_' + new Date().toISOString().split('T')[0],
        modified: false,
        currentTemplate: 'large',
        selectedCells: [],
        isSelecting: false,
        selectionStart: null,
        hasMovedDuringSelection: false
    };

    // DOM Elements
    let elements = {};

    // Initialize the application
    function init() {
        // Cache DOM elements
        cacheElements();
        
        // Set up event listeners
        setupEventListeners();
        
        // Initialize the table with default frame count
        generateTable(state.frameCount);
        
        // Set today's date in the date field
        elements.dateField.valueAsDate = new Date();
        
        // Initialize status
        updateStatusMessage('X-Sheet ready');

        // Check for auto-saved data
        checkForAutoSavedData();
        
        // Fire custom event for modules to initialize
        document.dispatchEvent(new CustomEvent('xsheet-initialized', { detail: state }));
    }

    // Cache DOM elements for better performance
    function cacheElements() {
        elements = {
            templateSelector: document.getElementById('template-selector'),
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
        // Template selector change
        elements.templateSelector.addEventListener('change', function() {
            state.currentTemplate = this.value;
            updateTemplate();
        });
        
        // Frame count change
        elements.frameCountInput.addEventListener('change', function() {
            state.frameCount = parseInt(this.value);
            if (state.frameCount < 8) state.frameCount = 8;
            generateTable(state.frameCount);
            updateStatusMessage('Frame count updated to ' + state.frameCount);
            
            // Notify other modules of the change
            document.dispatchEvent(new CustomEvent('xsheet-framecount-changed', { 
                detail: { frameCount: state.frameCount } 
            }));
        });
        
        // Button event listeners
        elements.saveButton.addEventListener('click', saveProject);
        elements.loadButton.addEventListener('click', loadProject);
        elements.pdfButton.addEventListener('click', function() {
            // Export event will be handled by export.js
            document.dispatchEvent(new Event('xsheet-export-pdf'));
        });
        elements.printButton.addEventListener('click', function() {
            // Print event will be handled by export.js
            document.dispatchEvent(new Event('xsheet-print'));
        });
        elements.addRowsButton.addEventListener('click', addEightRows);
        elements.clearButton.addEventListener('click', clearSheet);
        
        // Monitor for changes to set modified flag
        document.addEventListener('input', function(e) {
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

    // Update template (size and frame count)
    function updateTemplate() {
        if (state.currentTemplate === 'large') {
            // 11"x17" template (96 frames)
            document.body.style.maxWidth = '11in';
            document.body.style.maxHeight = '17in';
            document.body.style.fontSize = '9pt';
            elements.frameCountInput.value = 96;
            state.frameCount = 96;
        } else {
            // 8"x10" template (48 frames)
            document.body.style.maxWidth = '8in';
            document.body.style.maxHeight = '10in';
            document.body.style.fontSize = '8pt';
            elements.frameCountInput.value = 48;
            state.frameCount = 48;
        }
        
        generateTable(state.frameCount);
        updateStatusMessage('Template switched to ' + (state.currentTemplate === 'large' ? '11"x17"' : '8"x10"'));
        
        // Notify other modules of the change
        document.dispatchEvent(new CustomEvent('xsheet-template-changed', { 
            detail: { template: state.currentTemplate } 
        }));
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
            cell.addEventListener('keydown', function(e) {
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
            cell.addEventListener('keyup', function(e) {
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
        document.addEventListener('click', function(e) {
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
        document.getElementById('xsheet-table').addEventListener('click', function(e) {
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
        
        // Handle mousedown for selection start
        editableCells.forEach(cell => {
            // Mousedown - start potential selection
            cell.addEventListener('mousedown', function(e) {
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
            cell.addEventListener('keydown', function(e) {
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
        document.addEventListener('mousemove', function(e) {
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
        document.addEventListener('mouseup', function() {
            // End selection mode but keep selected cells
            if (state.isSelecting) {
                state.isSelecting = false;
                
                // Use setTimeout to delay resetting the hasMovedDuringSelection flag
                // This gives the click handler a chance to see the flag first
                if (state.hasMovedDuringSelection) {
                    setTimeout(function() {
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
        document.addEventListener('paste', function(e) {
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
        navigator.clipboard.writeText(cellData)
            .then(() => {
                updateStatusMessage('Copied selected cells to clipboard');
            })
            .catch(err => {
                updateStatusMessage('Failed to copy: ' + err);
            });
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
            template: state.currentTemplate,
            frameCount: state.frameCount,
            metadata: {
                projectNumber: document.getElementById('project-number').value,
                date: document.getElementById('project-date').value,
                pageNumber: document.getElementById('page-number').value,
                animatorName: document.getElementById('animator-name').value,
                versionNumber: document.getElementById('version-number').value,
                shotNumber: document.getElementById('shot-number').value
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
        const rows = elements.tableBody.querySelectorAll('tr');
        rows.forEach(row => {
            const rowData = {
                action: row.cells[0].innerText,
                frame: row.cells[1].innerText,
                // Skip waveform cell (2)
                dialogue: row.cells[3].innerText,
                sound: row.cells[4].innerText,
                technical: row.cells[5].innerText,
                extra1: row.cells[6].innerText,
                extra2: row.cells[7].innerText,
                frameRepeat: row.cells[8].innerText,
                camera: row.cells[9].innerText
            };
            data.rows.push(rowData);
        });
        
        return data;
    }

    // Restore data to the X-Sheet
    function restoreData(data) {
        if (!data) return;
        
        // Update template and frame count
        state.currentTemplate = data.template || 'large';
        state.frameCount = data.frameCount || 96;
        
        // Update UI to match
        elements.templateSelector.value = state.currentTemplate;
        elements.frameCountInput.value = state.frameCount;
        
        // Restore metadata
        if (data.metadata) {
            document.getElementById('project-number').value = data.metadata.projectNumber || '';
            document.getElementById('project-date').value = data.metadata.date || '';
            document.getElementById('page-number').value = data.metadata.pageNumber || '';
            document.getElementById('animator-name').value = data.metadata.animatorName || '';
            document.getElementById('version-number').value = data.metadata.versionNumber || '';
            document.getElementById('shot-number').value = data.metadata.shotNumber || '';
        }
        
        // Generate the table with the right frame count
        generateTable(state.frameCount);
        updateTemplate();
        
        // Let other modules restore their data
        document.dispatchEvent(new CustomEvent('xsheet-restore-data', { 
            detail: { data },
            bubbles: true,
            cancelable: true
        }));
        
        // Restore row data
        if (data.rows && data.rows.length > 0) {
            const rows = elements.tableBody.querySelectorAll('tr');
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
        }
        
        // If no localStorage data, create file input for uploading JSON
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
        
        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = JSON.parse(e.target.result);
                    restoreData(data);
                } catch (error) {
                    updateStatusMessage('Error parsing file: ' + error.message);
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
        elements.frameCountInput.value = state.frameCount;
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
            document.getElementById('project-number').value = '';
            document.getElementById('page-number').value = '';
            document.getElementById('animator-name').value = '';
            document.getElementById('version-number').value = '';
            document.getElementById('shot-number').value = '';
            
            // Reset date to today
            document.getElementById('project-date').valueAsDate = new Date();
            
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
        elements.statusMessage.textContent = message;
        console.log(message);
        
        // Clear status message after 3 seconds
        setTimeout(() => {
            if (elements.statusMessage.textContent === message) {
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

    // Public API
    app.init = init;
    app.state = state;
    app.generateTable = generateTable;
    app.updateTemplate = updateTemplate;
    app.updateStatusMessage = updateStatusMessage;
    app.collectData = collectData;
    app.restoreData = restoreData;
    app.clearCellSelection = clearCellSelection;

})(window.XSheetApp);
