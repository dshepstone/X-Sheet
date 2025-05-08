/**
 * export.js - Export and printing functionality for Animation X-Sheet
 * Handles PDF export and printing with improved reliability
 */

// Create namespace for the export module
window.XSheetApp = window.XSheetApp || {};
window.XSheetApp.Export = window.XSheetApp.Export || {};

(function (app) {
    'use strict';

    // Initialize export functionality
    function init() {
        // Listen for export events
        document.addEventListener('xsheet-export-pdf', function () {
            exportToPDF();
        });

        document.addEventListener('xsheet-print', function () {
            printSheet();
        });
    }

    // Export to PDF functionality
    function exportToPDF() {
        // Save the FULL application state before PDF export
        const savedData = saveFullState();

        app.updateStatusMessage('Preparing PDF. Please wait...');

        // Prepare the document for export
        prepareForExport();

        // Add a class to trigger print styles
        document.body.classList.add('print-mode');

        // Improved timing sequence for print styles and drawing layer positioning
        setTimeout(() => {
            // Force layout recalculation
            document.body.offsetHeight;

            // First recalculation of drawing layer position
            recalculateDrawingLayerPosition();

            // Additional delay to ensure all styles are fully applied
            setTimeout(() => {
                // Second recalculation to ensure accuracy
                recalculateDrawingLayerPosition();

                try {
                    // Use html2canvas to capture the printable area with improved settings
                    html2canvas(document.getElementById('printable-area'), {
                        scale: 2, // Higher scale for better quality
                        useCORS: true,
                        logging: true,
                        allowTaint: true,
                        backgroundColor: '#ffffff',
                        scrollX: 0,
                        scrollY: -window.scrollY, // Handle scroll position correctly
                        windowWidth: document.documentElement.offsetWidth,
                        windowHeight: document.documentElement.offsetHeight
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

                            // Remove print mode class
                            document.body.classList.remove('print-mode');

                            // Clean up after PDF generation
                            cleanupAfterExport(savedData);
                        } catch (err) {
                            document.body.classList.remove('print-mode');
                            console.error('Error creating PDF:', err);
                            cleanupAfterExport(savedData);
                            app.updateStatusMessage('Error creating PDF: ' + err.message);
                        }
                    }).catch(err => {
                        document.body.classList.remove('print-mode');
                        console.error('HTML2Canvas error:', err);
                        cleanupAfterExport(savedData);
                        app.updateStatusMessage('Error creating PDF: ' + err.message);
                    });
                } catch (e) {
                    document.body.classList.remove('print-mode');
                    // Clean up if there was an error
                    cleanupAfterExport(savedData);
                    app.updateStatusMessage('Error exporting PDF: ' + e.message);
                }
            }, 300); // Adjusted delay for final style application
        }, 600); // Initial delay for print style application
    }

    // Save FULL application state including all drawing data
    function saveFullState() {
        // Get all data from the app
        const appData = app.collectData();

        // Save drawing data
        if (app.Drawing && app.Drawing.state.layerSystem) {
            appData.drawings = [];

            app.Drawing.state.layerSystem.layers.forEach(layer => {
                // Save layer data including all objects
                const layerData = {
                    name: layer.name,
                    visible: layer.visible,
                    objects: layer.objects.map(obj => obj.toJSON())
                };
                appData.drawings.push(layerData);
            });
        }

        // Save table selection state
        appData.tableState = saveSelectionState();

        // Record original body styles for restoration
        appData.originalBodyStyle = document.body.getAttribute('style') || '';
        appData.originalWidth = document.body.style.width;
        appData.originalHeight = document.body.style.height;

        return appData;
    }

    // Restore FULL application state
    function restoreFullState(fullState) {
        if (!fullState) return;

        // First restore the base app data
        app.restoreData(fullState);

        // Restore drawing data if available
        if (fullState.drawings && app.Drawing && app.Drawing.state.layerSystem) {
            const layerSystem = app.Drawing.state.layerSystem;

            // Clear existing layers
            layerSystem.clearAllLayers();

            // Restore each layer
            fullState.drawings.forEach((layerData, index) => {
                // Create layer if needed
                if (index >= layerSystem.layers.length) {
                    layerSystem.addLayer(layerData.name);
                } else {
                    layerSystem.layers[index].name = layerData.name;
                    layerSystem.layers[index].visible = layerData.visible;
                }

                // Restore objects
                layerData.objects.forEach(objData => {
                    const newObj = app.Drawing.DrawingObjectFactory.createFromJSON(objData);
                    if (newObj) {
                        layerSystem.layers[index].objects.push(newObj);
                    }
                });
            });

            // Redraw
            layerSystem.redrawAll();
        }

        // Restore table selection state
        if (fullState.tableState) {
            restoreTableState(fullState.tableState);
        }

        // Restore body styles
        if (fullState.originalBodyStyle) {
            document.body.setAttribute('style', fullState.originalBodyStyle);
            if (fullState.originalWidth) document.body.style.width = fullState.originalWidth;
            if (fullState.originalHeight) document.body.style.height = fullState.originalHeight;
        }
    }

    // Print functionality with improved reliability
    function printSheet() {
        app.updateStatusMessage('Preparing to print. Please wait...');

        // Save FULL application state including all drawing data
        const fullState = saveFullState();

        // Prepare the document for printing
        prepareForExport();

        // Add a class to trigger print styles
        document.body.classList.add('print-mode');

        // Set up event listeners for print events
        const beforePrintHandler = () => {
            // Ensure positioning is correct at the exact moment of printing
            recalculateDrawingLayerPosition();
        };

        const afterPrintHandler = () => {
            // Clean up after printing with a slight delay
            setTimeout(() => {
                document.body.classList.remove('print-mode');
                cleanupAfterPrint();
                restoreFullState(fullState);
                app.updateStatusMessage('Print complete');

                // Remove event listeners
                window.removeEventListener('beforeprint', beforePrintHandler);
                window.removeEventListener('afterprint', afterPrintHandler);
            }, 500);
        };

        // Add event listeners
        window.addEventListener('beforeprint', beforePrintHandler);
        window.addEventListener('afterprint', afterPrintHandler);

        // Improved timing sequence for print styles and drawing layer positioning
        setTimeout(() => {
            // Force layout recalculation
            document.body.offsetHeight;

            // First recalculation of drawing layer position
            recalculateDrawingLayerPosition();

            // Additional delay to ensure all styles are fully applied
            setTimeout(() => {
                // Second recalculation to ensure accuracy
                recalculateDrawingLayerPosition();

                // Trigger the print dialog
                window.print();

                // Fallback cleanup in case afterprint doesn't fire (happens in some browsers)
                const backupTimer = setTimeout(() => {
                    if (document.body.classList.contains('print-mode')) {
                        document.body.classList.remove('print-mode');
                        cleanupAfterPrint();
                        restoreFullState(fullState);
                        app.updateStatusMessage('Print complete (fallback)');

                        // Remove event listeners
                        window.removeEventListener('beforeprint', beforePrintHandler);
                        window.removeEventListener('afterprint', afterPrintHandler);
                    }
                }, 5000);
            }, 300); // Improved timing
        }, 600); // Improved initial delay
    }

    // Prepare document for export/print
    function prepareForExport() {
        // Hide UI controls
        hideUIControls();

        // Draw the waveform directly into the cells before export
        if (app.Audio && app.Audio.state.audioBuffer && app.Audio.state.waveformData.length > 0) {
            app.Audio.drawWaveformInCells();
        }

        // Prepare drawing layers for export using improved method
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

    // Improved function for preparing drawing layers for export
    function prepareDrawingLayersForExport() {
        // Skip if drawing system not initialized
        if (!app.Drawing || !app.Drawing.state.layerSystem) {
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;
        const table = document.getElementById('xsheet-table');

        // Save original properties and state
        layerContainer._originalDisplay = layerContainer.style.display;
        layerContainer._originalZIndex = layerContainer.style.zIndex;
        layerContainer._originalPosition = layerContainer.style.position;
        layerContainer._originalParent = layerContainer.parentNode;
        layerContainer._tableRef = table;

        // Get table position for reference
        const printableArea = document.getElementById('printable-area');
        const printableRect = printableArea.getBoundingClientRect();
        const tableRect = table.getBoundingClientRect();

        // Store the initial positions
        layerContainer._printData = {
            tableTop: tableRect.top,
            tableLeft: tableRect.left,
            tableWidth: tableRect.width,
            tableHeight: tableRect.height,
            printableTop: printableRect.top,
            printableLeft: printableRect.left,
            viewportScrollX: window.scrollX,
            viewportScrollY: window.scrollY
        };

        // Switch to fixed positioning to maintain position during print
        layerContainer.style.position = 'fixed';
        layerContainer.style.zIndex = '1000';
        layerContainer.style.display = 'block';

        // Set flag to track print mode
        layerSystem._inPrintMode = true;

        // Initial positioning
        updateDrawingLayerPrintPosition(layerSystem);
    }

    // Helper function to update drawing layer position during print
    function updateDrawingLayerPrintPosition(layerSystem) {
        if (!layerSystem || !layerSystem._inPrintMode) return;

        const layerContainer = layerSystem.container;
        const table = document.getElementById('xsheet-table');

        if (!table || !layerContainer._printData) return;

        // Get current positions
        const tableRect = table.getBoundingClientRect();
        const printData = layerContainer._printData;

        // Position fixed to the table's current location in the viewport
        layerContainer.style.top = tableRect.top + 'px';
        layerContainer.style.left = tableRect.left + 'px';
        layerContainer.style.width = tableRect.width + 'px';
        layerContainer.style.height = tableRect.height + 'px';

        // Scale layers if table size changed
        const scaleX = tableRect.width / printData.tableWidth;
        const scaleY = tableRect.height / printData.tableHeight;

        // Apply scaling to each layer canvas
        layerSystem.layers.forEach(layer => {
            layer.canvas.style.transformOrigin = 'top left';
            layer.canvas.style.transform = `scale(${scaleX}, ${scaleY})`;
        });

        // Force reflow to ensure positioning is applied
        layerContainer.offsetHeight;
    }

    // Recalculate drawing layer position - IMPROVED
    function recalculateDrawingLayerPosition() {
        if (!app.Drawing || !app.Drawing.state.layerSystem) {
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;

        // Use the new positioning method
        if (layerSystem._inPrintMode) {
            updateDrawingLayerPrintPosition(layerSystem);
        }
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

    // Restore table state (selection and cell contents)
    function restoreTableState(tableData) {
        if (!tableData) return;

        // Restore metadata fields
        if (tableData.metadata) {
            document.getElementById('project-number').value = tableData.metadata.projectNumber || '';
            document.getElementById('project-date').value = tableData.metadata.date || '';
            document.getElementById('page-number').value = tableData.metadata.pageNumber || '';
            document.getElementById('animator-name').value = tableData.metadata.animatorName || '';
            document.getElementById('version-number').value = tableData.metadata.versionNumber || '';
            document.getElementById('shot-number').value = tableData.metadata.shotNumber || '';
        }

        // Restore waveform cell content
        const waveformCells = document.querySelectorAll('.waveform-col');
        waveformCells.forEach(cell => {
            const originalContent = cell.getAttribute('data-original-content');
            if (originalContent !== null) {
                cell.innerHTML = originalContent;
                cell.removeAttribute('data-original-content');
            }
        });

        // Restore editable cell contents
        if (tableData.cellContents) {
            const tableBody = document.getElementById('xsheet-body');
            tableData.cellContents.forEach(cellData => {
                if (cellData.rowIndex >= 0 && cellData.rowIndex < tableBody.children.length) {
                    const row = tableBody.children[cellData.rowIndex];
                    if (cellData.colIndex >= 0 && cellData.colIndex < row.children.length) {
                        const cell = row.children[cellData.colIndex];

                        // Skip waveform cells (handled above)
                        if (!cell.classList.contains('waveform-col')) {
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

        // Restore selection
        restoreSelectionState(tableData);
    }

    // Restore selection state after print
    function restoreSelectionState(tableData) {
        if (!tableData || !tableData.selectedIndices) return;

        // Clear current selection
        if (app.clearCellSelection) {
            app.clearCellSelection();
        }

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

    // Improved cleanup after printing
    function cleanupAfterPrint() {
        // Show UI controls
        showUIControls();

        // Restore the original waveform container
        const originalWf = document.querySelector('.waveform-container');
        if (originalWf) {
            originalWf.style.display = '';
        }

        // Clean up drawing layers
        cleanupDrawingLayersAfterPrint();
    }

    // Clean up after PDF export
    function cleanupAfterExport(savedData) {
        // Show UI controls
        showUIControls();

        // Clean up drawing layers
        cleanupDrawingLayersAfterPrint();

        // Restore full state
        restoreFullState(savedData);
    }

    // Clean up drawing layers after print
    function cleanupDrawingLayersAfterPrint() {
        if (!app.Drawing || !app.Drawing.state.layerSystem) {
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;

        // Restore original properties
        if (layerContainer._originalDisplay) {
            layerContainer.style.display = layerContainer._originalDisplay;
        }
        if (layerContainer._originalZIndex) {
            layerContainer.style.zIndex = layerContainer._originalZIndex;
        }
        if (layerContainer._originalPosition) {
            layerContainer.style.position = layerContainer._originalPosition;
        }

        // Restore original parent if needed
        if (layerContainer._originalParent && layerContainer.parentNode !== layerContainer._originalParent) {
            layerContainer._originalParent.appendChild(layerContainer);
        }

        // Remove transforms from canvases
        layerSystem.layers.forEach(layer => {
            layer.canvas.style.transform = '';
        });

        // Clear temporary data
        delete layerContainer._originalDisplay;
        delete layerContainer._originalZIndex;
        delete layerContainer._originalPosition;
        delete layerContainer._originalParent;
        delete layerContainer._tableRef;
        delete layerContainer._printData;
        delete layerSystem._inPrintMode;
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