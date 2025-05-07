/**
 * export.js - Export and printing functionality for Animation X-Sheet
 * Handles PDF export and printing with improved reliability
 */

// Create namespace for the export module
window.XSheetApp = window.XSheetApp || {};
window.XSheetApp.Export = window.XSheetApp.Export || {};

(function(app) {
    'use strict';
    
    // Initialize export functionality
    function init() {
        // Listen for export events
        document.addEventListener('xsheet-export-pdf', function() {
            exportToPDF();
        });
        
        document.addEventListener('xsheet-print', function() {
            printSheet();
        });
    }
    
    // Export to PDF functionality
    function exportToPDF() {
        // Save the current state before PDF export
        const savedData = app.collectData();
        
        app.updateStatusMessage('Preparing PDF. Please wait...');
        
        // Prepare the document for export
        prepareForExport();
        
        // Wait a moment for DOM updates to complete
        setTimeout(() => {
            try {
                // Use html2canvas to capture the printable area
                html2canvas(document.getElementById('printable-area'), {
                    scale: 1.5, // Lower scale factor for better performance
                    useCORS: true,
                    logging: true, // Enable for troubleshooting
                    allowTaint: true,
                    backgroundColor: '#ffffff'
                }).then(canvas => {
                    try {
                        const imgData = canvas.toDataURL('image/png');
                        
                        // Determine PDF size based on template
                        let pdfWidth, pdfHeight;
                        if (app.state.currentTemplate === 'large') {
                            // 11"x17"
                            pdfWidth = 279.4; // mm
                            pdfHeight = 431.8; // mm
                        } else {
                            // 8.5"x11"
                            pdfWidth = 215.9; // mm
                            pdfHeight = 279.4; // mm
                        }
                        
                        // Create PDF with jsPDF
                        const { jsPDF } = window.jspdf;
                        const pdf = new jsPDF({
                            orientation: 'portrait',
                            unit: 'mm',
                            format: [pdfWidth, pdfHeight]
                        });
                        
                        // Calculate aspect ratio
                        const imgWidth = pdfWidth - 20; // margins
                        const imgHeight = canvas.height * imgWidth / canvas.width;
                        
                        // Add image to PDF
                        pdf.addImage(imgData, 'PNG', 10, 10, imgWidth, imgHeight);
                        
                        // Save PDF
                        pdf.save(`${app.state.projectName}.pdf`);
                        
                        // Clean up after PDF generation
                        cleanupAfterExport(savedData);
                    } catch (err) {
                        console.error('Error creating PDF:', err);
                        cleanupAfterExport(savedData);
                        app.updateStatusMessage('Error creating PDF: ' + err.message);
                    }
                }).catch(err => {
                    console.error('HTML2Canvas error:', err);
                    cleanupAfterExport(savedData);
                    app.updateStatusMessage('Error creating PDF: ' + err.message);
                });
            } catch (e) {
                // Clean up if there was an error
                cleanupAfterExport(savedData);
                app.updateStatusMessage('Error exporting PDF: ' + e.message);
            }
        }, 1000); // Increased timeout for better reliability
    }
    
    // Print functionality
    function printSheet() {
        app.updateStatusMessage('Preparing to print. Please wait...');
        
        // Save current selection state and cell contents
        const tableData = saveSelectionState();
        
        // Record original body styles for restoration
        const originalBodyStyle = document.body.getAttribute('style') || '';
        const originalWidth = document.body.style.width;
        const originalHeight = document.body.style.height;
        
        // Prepare the document for printing
        prepareForExport();
        
        // Wait a moment for DOM updates to complete
        setTimeout(() => {
            window.print();
            
            // Clean up after printing
            setTimeout(() => {
                cleanupAfterPrint(tableData, originalBodyStyle, originalWidth, originalHeight);
                app.updateStatusMessage('Print complete');
            }, 1000);
        }, 500);
    }
    
    // Prepare document for export/print
    function prepareForExport() {
        // Hide UI controls
        hideUIControls();
        
        // Draw the waveform directly into the cells before export
        if (app.Audio && app.Audio.state.audioBuffer && app.Audio.state.waveformData.length > 0) {
            app.Audio.drawWaveformInCells();
        }
        
        // Prepare drawing layers for export
        prepareDrawingLayersForExport();
    }
    
    // Hide UI controls during export/print
    function hideUIControls() {
        const elements = [
            document.querySelector('.controls'),
            document.querySelector('#audio-controls'),
            document.querySelector('.status'),
            document.querySelector('#phonetic-input'),
            document.querySelector('.drawing-toolbar')
        ];
        
        elements.forEach(element => {
            if (element) {
                element.style.display = 'none';
            }
        });
    }
    
    // Show UI controls after export/print
    function showUIControls() {
        const elements = [
            { el: document.querySelector('.controls'), display: 'flex' },
            { el: document.querySelector('#audio-controls'), display: 'flex' },
            { el: document.querySelector('.status'), display: 'block' },
            { el: document.querySelector('.drawing-toolbar'), display: 'flex' }
        ];
        
        elements.forEach(item => {
            if (item.el) {
                item.el.style.display = item.display;
            }
        });
    }
    
    // Prepare drawing layers for export
    function prepareDrawingLayersForExport() {
        // Skip if drawing system not initialized
        if (!app.Drawing || !app.Drawing.state.layerSystem) {
            return;
        }
        
        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;
        
        // 1) Save original CSS & DOM parent
        layerContainer._originalDisplay = layerContainer.style.display;
        layerContainer._originalPos = layerContainer.style.position;
        layerContainer._originalTop = layerContainer.style.top;
        layerContainer._originalLeft = layerContainer.style.left;
        layerContainer._originalZIndex = layerContainer.style.zIndex;
        layerContainer._originalWidth = layerContainer.style.width;
        layerContainer._originalHeight = layerContainer.style.height;
        layerContainer._originalParent = layerContainer.parentNode;
        
        // 2) Make it visible for capture
        layerContainer.style.display = 'block';
        
        // 3) Compute offsets
        const printableArea = document.getElementById('printable-area');
        const printableRect = printableArea.getBoundingClientRect();
        const table = document.getElementById('xsheet-table');
        const tableRect = table.getBoundingClientRect();
        
        // 4) Reparent into the printable area
        printableArea.appendChild(layerContainer);
        
        // 5) Force absolute positioning & explicit size
        layerContainer.style.position = 'absolute';
        layerContainer.style.top = `${tableRect.top - printableRect.top}px`;
        layerContainer.style.left = `${tableRect.left - printableRect.left}px`;
        layerContainer.style.width = `${tableRect.width}px`;
        layerContainer.style.height = `${tableRect.height}px`;
        layerContainer.style.zIndex = '1000';
    }
    
    // Save selection state and cell contents
    function saveSelectionState() {
        // Get selected cells
        const selectedCells = document.querySelectorAll('.selected-cell');
        
        // Save selection state and all cell contents
        const tableData = {
            // Save which cells are selected
            selectedIndices: Array.from(selectedCells).map(cell => {
                const row = cell.closest('tr');
                const rowIndex = Array.from(document.getElementById('xsheet-body').children).indexOf(row);
                const colIndex = Array.from(row.children).indexOf(cell);
                return { rowIndex, colIndex };
            }),
            
            // Save metadata fields
            metadata: {
                projectNumber: document.getElementById('project-number').value,
                date: document.getElementById('project-date').value,
                pageNumber: document.getElementById('page-number').value,
                animatorName: document.getElementById('animator-name').value,
                versionNumber: document.getElementById('version-number').value,
                shotNumber: document.getElementById('shot-number').value
            },
            
            // Store all editable cells' content
            cellContents: []
        };
        
        // Store waveform cells original content
        const waveformCells = document.querySelectorAll('.waveform-col');
        waveformCells.forEach(cell => {
            cell.setAttribute('data-original-content', cell.innerHTML);
        });
        
        // Store all editable cells' content
        const allEditableCells = document.querySelectorAll('[contenteditable="true"]');
        allEditableCells.forEach(cell => {
            const row = cell.closest('tr');
            if (row) {
                const rowIndex = Array.from(document.getElementById('xsheet-body').children).indexOf(row);
                const colIndex = Array.from(row.children).indexOf(cell);
                tableData.cellContents.push({
                    rowIndex,
                    colIndex,
                    content: cell.innerHTML,
                    isModified: cell.classList.contains('modified')
                });
            }
        });
        
        return tableData;
    }
    
    // Restore selection state after print
    function restoreSelectionState(tableData) {
        if (!tableData || !tableData.selectedIndices) return;
        
        // Clear current selection
        app.clearCellSelection();
        
        // Restore selection
        const tableBody = document.getElementById('xsheet-body');
        tableData.selectedIndices.forEach(index => {
            if (index.rowIndex >= 0 && index.rowIndex < tableBody.children.length) {
                const row = tableBody.children[index.rowIndex];
                if (index.colIndex >= 0 && index.colIndex < row.children.length) {
                    const cell = row.children[index.colIndex];
                    if (cell.contentEditable === 'true') {
                        cell.classList.add('selected-cell');
                    }
                }
            }
        });
    }
    
    // Clean up after PDF export
    function cleanupAfterExport(savedData) {
        // Restore UI controls
        showUIControls();
        
        // Restore drawing layers
        restoreDrawingLayers();
        
        // Restore data
        app.restoreData(savedData);
    }
    
    // Clean up after printing
    function cleanupAfterPrint(tableData, originalBodyStyle, originalWidth, originalHeight) {
        // Restore UI controls
        showUIControls();
        
        // Restore the original waveform container
        const originalWf = document.querySelector('.waveform-container');
        if (originalWf) {
            originalWf.style.display = '';
        }
        
        // Restore drawing layers
        restoreDrawingLayers();
        
        // Restore original cell content for waveform cells only
        const waveformCells = document.querySelectorAll('.waveform-col');
        waveformCells.forEach(cell => {
            const originalContent = cell.getAttribute('data-original-content');
            if (originalContent !== null) {
                cell.innerHTML = originalContent;
                cell.removeAttribute('data-original-content');
            }
        });
        
        // Restore all cell contents from saved data
        if (tableData && tableData.cellContents) {
            const tableBody = document.getElementById('xsheet-body');
            tableData.cellContents.forEach(cellData => {
                if (cellData.rowIndex >= 0 && cellData.rowIndex < tableBody.children.length) {
                    const row = tableBody.children[cellData.rowIndex];
                    if (cellData.colIndex >= 0 && cellData.colIndex < row.children.length) {
                        const cell = row.children[cellData.colIndex];
                        
                        // Skip waveform cells (they were already restored above)
                        if (!cell.classList.contains('waveform-col')) {
                            // Only restore if cell is editable
                            if (cell.contentEditable === 'true') {
                                cell.innerHTML = cellData.content;
                                
                                // Restore modified status
                                if (cellData.isModified) {
                                    cell.classList.add('modified');
                                } else {
                                    cell.classList.remove('modified');
                                }
                            }
                        }
                    }
                }
            });
        }
        
        // Restore metadata fields
        if (tableData && tableData.metadata) {
            document.getElementById('project-number').value = tableData.metadata.projectNumber || '';
            document.getElementById('project-date').value = tableData.metadata.date || '';
            document.getElementById('page-number').value = tableData.metadata.pageNumber || '';
            document.getElementById('animator-name').value = tableData.metadata.animatorName || '';
            document.getElementById('version-number').value = tableData.metadata.versionNumber || '';
            document.getElementById('shot-number').value = tableData.metadata.shotNumber || '';
        }
        
        // Restore cell selection state
        restoreSelectionState(tableData);
        
        // Restore body styles to prevent page size shifting
        document.body.setAttribute('style', originalBodyStyle);
        document.body.style.width = originalWidth;
        document.body.style.height = originalHeight;
        
        // Force layout recalculation
        document.body.offsetHeight;
    }
    
    // Restore drawing layers to original state
    function restoreDrawingLayers() {
        // Skip if drawing system not initialized
        if (!app.Drawing || !app.Drawing.state.layerSystem) {
            return;
        }
        
        const layerContainer = app.Drawing.state.layerSystem.container;
        
        // Only restore if we saved original values
        if (layerContainer._originalParent) {
            // Restore properties
            layerContainer.style.display = layerContainer._originalDisplay;
            layerContainer.style.position = layerContainer._originalPos;
            layerContainer.style.top = layerContainer._originalTop;
            layerContainer.style.left = layerContainer._originalLeft;
            layerContainer.style.zIndex = layerContainer._originalZIndex;
            layerContainer.style.width = layerContainer._originalWidth;
            layerContainer.style.height = layerContainer._originalHeight;
            
            // Move back to original parent
            layerContainer._originalParent.appendChild(layerContainer);
            
            // Clear temporary properties
            delete layerContainer._originalDisplay;
            delete layerContainer._originalPos;
            delete layerContainer._originalTop;
            delete layerContainer._originalLeft;
            delete layerContainer._originalZIndex;
            delete layerContainer._originalWidth;
            delete layerContainer._originalHeight;
            delete layerContainer._originalParent;
        }
    }
    
    // Public API
    app.Export = {
        init,
        exportToPDF,
        printSheet
    };
    
    // Initialize on DOM ready
    document.addEventListener('DOMContentLoaded', init);
    
})(window.XSheetApp);
