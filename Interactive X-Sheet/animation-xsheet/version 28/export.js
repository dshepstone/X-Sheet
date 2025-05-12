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
        app.updateStatusMessage('Preparing PDF. Please wait...');
        const savedData = app.collectData(); // Collect data before DOM manipulation

        prepareForExport(); // Moves drawing layer, draws cell waveforms etc.

        document.body.classList.add('print-mode'); // Apply print-like styles for consistency

        setTimeout(() => { // Delay for styles to apply
            document.body.offsetHeight; // Force reflow
            recalculateDrawingLayerPosition(); // Position drawing layer based on new layout

            setTimeout(() => { // Further delay for rendering changes
                try {
                    html2canvas(document.getElementById('printable-area'), {
                        scale: 2, // Increased scale for better quality
                        useCORS: true,
                        logging: false, // Set to true for debugging html2canvas
                        allowTaint: true,
                        backgroundColor: '#ffffff',
                        scrollX: 0, // Explicitly tell html2canvas not to account for scroll
                        scrollY: 0
                    }).then(canvas => {
                        try {
                            const imgData = canvas.toDataURL('image/png');
                            const { jsPDF } = window.jspdf;

                            // Letter size dimensions in mm
                            const pdfWidth = 215.9;
                            const pdfHeight = 279.4;
                            const margin = 10; // 10mm margin

                            const contentWidth = pdfWidth - (2 * margin);
                            const contentHeight = pdfHeight - (2 * margin);

                            let imgDisplayWidth, imgDisplayHeight;

                            // Calculate image dimensions to fit within content area while maintaining aspect ratio
                            if ((canvas.width / canvas.height) >= (contentWidth / contentHeight)) {
                                imgDisplayWidth = contentWidth;
                                imgDisplayHeight = canvas.height * (contentWidth / canvas.width);
                            } else {
                                imgDisplayHeight = contentHeight;
                                imgDisplayWidth = canvas.width * (contentHeight / canvas.height);
                            }

                            const pdf = new jsPDF({
                                orientation: 'portrait',
                                unit: 'mm',
                                format: 'letter' // [pdfWidth, pdfHeight]
                            });

                            // Check if image needs to be split into multiple pages
                            const totalImageHeightInMm = canvas.height * (pdfWidth / canvas.width); // Full image height if scaled to PDF width
                            let currentY = margin;
                            let remainingImageHeight = canvas.height; // Pixel height
                            let sourceY = 0; // Source Y in original canvas pixels

                            const pageCanvas = document.createElement('canvas');
                            const pageCtx = pageCanvas.getContext('2d');
                            pageCanvas.width = canvas.width; // Use original canvas width for slicing

                            // Calculate how many pixels of the original canvas fit on one PDF page height
                            const pixelsPerPdfPageHeight = (contentHeight / contentWidth) * canvas.width;


                            let pageNum = 0;
                            while (remainingImageHeight > 10) { // Add a small tolerance
                                if (pageNum > 0) {
                                    pdf.addPage();
                                }
                                pageNum++;
                                currentY = margin;

                                let sliceHeight = Math.min(remainingImageHeight, pixelsPerPdfPageHeight);
                                if (remainingImageHeight - sliceHeight < 10) sliceHeight = remainingImageHeight; // grab the rest

                                pageCanvas.height = sliceHeight;
                                pageCtx.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

                                const pageImgData = pageCanvas.toDataURL('image/png');
                                let pageImgDisplayHeight = sliceHeight * (contentWidth / canvas.width);

                                pdf.addImage(pageImgData, 'PNG', margin, currentY, contentWidth, pageImgDisplayHeight);

                                sourceY += sliceHeight;
                                remainingImageHeight -= sliceHeight;

                                if (pageNum > 20) { // Safety break for too many pages
                                    console.warn("PDF generation stopped after 20 pages.");
                                    break;
                                }
                            }


                            pdf.save(`${app.state.projectName || 'XSheet'}.pdf`);
                            app.updateStatusMessage('PDF exported successfully.');
                        } catch (err) {
                            console.error('Error during PDF creation or saving:', err);
                            app.updateStatusMessage('Error creating PDF: ' + err.message);
                        } finally {
                            document.body.classList.remove('print-mode');
                            cleanupAfterExport(savedData); // Restore original state
                        }
                    }).catch(err => {
                        console.error('HTML2Canvas error:', err);
                        app.updateStatusMessage('Error capturing page for PDF: ' + err.message);
                        document.body.classList.remove('print-mode');
                        cleanupAfterExport(savedData);
                    });
                } catch (e) {
                    console.error('Error setting up PDF export:', e);
                    app.updateStatusMessage('Error exporting PDF: ' + e.message);
                    document.body.classList.remove('print-mode');
                    cleanupAfterExport(savedData);
                }
            }, 250); // Increased delay for rendering complex drawing layers
        }, 500); // Initial delay for print-mode styles and prepareForExport
    }

    // Print functionality
    function printSheet() {
        app.updateStatusMessage('Preparing to print. Please wait...');

        const tableData = saveSelectionState(); // Save content and selections
        const originalBodyClassName = document.body.className; // Save class names

        prepareForExport(); // This includes moving drawing layer, drawing cell waveforms

        // Defer actions to allow DOM updates from prepareForExport to settle
        setTimeout(() => {
            document.body.classList.add('print-mode'); // Apply print-specific CSS
            document.body.offsetHeight; // Force browser to recalculate layout with new styles

            recalculateDrawingLayerPosition(); // Position drawing layer based on print layout

            window.print(); // Open print dialog

            // Cleanup can be tricky as print dialog is asynchronous.
            // 'onafterprint' is an option but not universally supported or reliable for all actions.
            // A timeout is a common fallback.
            const cleanup = () => {
                document.body.classList.remove('print-mode');
                document.body.className = originalBodyClassName; // Restore original classes
                cleanupAfterPrint(tableData, null /* originalBodyStyle no longer used this way */);
                app.updateStatusMessage('Print job sent.');
                window.removeEventListener('afterprint', cleanup); // Clean up listener
            };

            if (window.onafterprint !== undefined) {
                window.addEventListener('afterprint', cleanup, { once: true });
            } else {
                // Fallback for browsers that don't support onafterprint well for this
                setTimeout(cleanup, 2000); // Give some time for print dialog
            }

        }, 500); // Delay for prepareForExport to complete
    }

    // Prepare document for export/print
    function prepareForExport() {
        // Hide UI controls - this should be handled by @media print or .print-mode class
        // hideUIControls(); // Can be removed if CSS handles it

        if (app.Audio && app.Audio.state.audioBuffer && app.Audio.state.waveformData.length > 0) {
            app.Audio.drawWaveformInCells(); // This prepares static waveforms in cells
        }

        prepareDrawingLayersForExport(); // This moves the drawing layer into printable-area
    }

    // Hide UI controls during export/print - OBSOLETE if CSS handles it
    // function hideUIControls() { ... }

    // Show UI controls after export/print - OBSOLETE if CSS handles it
    // function showUIControls() { ... }

    function prepareDrawingLayersForExport() {
        if (!app.Drawing || !app.Drawing.state.layerSystem || !app.Drawing.state.layerSystem.container) {
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;

        // Save original properties if not already saved (e.g., if called multiple times)
        if (layerContainer._originalParent === undefined) {
            layerContainer._originalDisplay = layerContainer.style.display;
            layerContainer._originalPos = layerContainer.style.position;
            layerContainer._originalTop = layerContainer.style.top;
            layerContainer._originalLeft = layerContainer.style.left;
            layerContainer._originalZIndex = layerContainer.style.zIndex;
            layerContainer._originalWidth = layerContainer.style.width;
            layerContainer._originalHeight = layerContainer.style.height;
            layerContainer._originalParent = layerContainer.parentNode;
        }


        layerContainer.style.display = 'block'; // Ensure it's visible for capture/print

        const printableArea = document.getElementById('printable-area');
        if (layerContainer.parentNode !== printableArea) {
            printableArea.appendChild(layerContainer); // Move into printable area
        }

        // Defer actual positioning to recalculateDrawingLayerPosition,
        // which should be called AFTER print/pdf styles are applied.
        layerContainer._tableRef = document.getElementById('xsheet-table'); // Store reference
    }

    function recalculateDrawingLayerPosition() {
        if (!app.Drawing || !app.Drawing.state.layerSystem || !app.Drawing.state.layerSystem.container) {
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;
        const table = layerContainer._tableRef || document.getElementById('xsheet-table');

        if (!table || !layerContainer.parentNode) return;

        // Position using offset values from table, relative to its current parent (should be printable-area)
        layerContainer.style.position = 'absolute'; // Ensure it's absolute
        layerContainer.style.top = table.offsetTop + 'px';
        layerContainer.style.left = table.offsetLeft + 'px';
        layerContainer.style.width = table.offsetWidth + 'px';
        layerContainer.style.height = table.offsetHeight + 'px';
        layerContainer.style.zIndex = '10'; // Above table content but below any print dialogs
    }

    function saveSelectionState() {
        const selectedCells = Array.from(document.querySelectorAll('.selected-cell'));
        const tableData = {
            selectedIndices: selectedCells.map(cell => {
                const row = cell.closest('tr');
                const rowIndex = row ? Array.from(document.getElementById('xsheet-body').children).indexOf(row) : -1;
                const colIndex = row ? Array.from(row.children).indexOf(cell) : -1;
                return { rowIndex, colIndex };
            }),
            metadata: {},
            cellContents: []
        };

        const metadataIds = ['project-number', 'project-date', 'page-number', 'animator-name', 'version-number', 'shot-number'];
        metadataIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) tableData.metadata[id] = el.value;
        });

        const waveformCells = document.querySelectorAll('.waveform-col');
        waveformCells.forEach(cell => {
            cell.setAttribute('data-original-content', cell.innerHTML); // Save for restoration
        });

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

    function restoreSelectionState(tableData) {
        if (!tableData || !tableData.selectedIndices) return;

        app.clearCellSelection(); // From core.js

        const tableBody = document.getElementById('xsheet-body');
        if (!tableBody) return;

        tableData.selectedIndices.forEach(index => {
            if (index.rowIndex >= 0 && tableBody.children[index.rowIndex]) {
                const row = tableBody.children[index.rowIndex];
                if (index.colIndex >= 0 && row.children[index.colIndex]) {
                    const cell = row.children[index.colIndex];
                    if (cell.contentEditable === 'true') {
                        app.XSheetApp.state.selectedCells.push(cell); // Use core state for consistency
                        cell.classList.add('selected-cell');
                    }
                }
            }
        });
    }

    function cleanupAfterExport(savedData) {
        // UI controls visibility should be handled by removing .print-mode class
        // showUIControls(); // Can be removed

        restoreDrawingLayers(); // Move drawing layer back to its original parent and style

        // Restore the full application data (including table content, metadata, audio, etc.)
        if (app.restoreData && savedData) {
            app.restoreData(savedData);
        }
        app.updateStatusMessage("Export cleanup complete.");
    }

    function cleanupAfterPrint(tableData, originalBodyStyle /* unused */) {
        // UI controls visibility handled by class removal
        // showUIControls(); 

        // Restore drawing layers to original state
        restoreDrawingLayers();

        const tableBody = document.getElementById('xsheet-body');

        // Restore waveform cells original content (which was canvases)
        // to whatever they were before (usually empty or placeholder for dynamic waveform)
        const waveformCells = document.querySelectorAll('.waveform-col');
        waveformCells.forEach(cell => {
            const originalContent = cell.getAttribute('data-original-content');
            if (originalContent !== null) {
                cell.innerHTML = originalContent;
                cell.removeAttribute('data-original-content');
            }
        });

        // If app.restoreData is not used, restore specifics:
        if (tableData && tableData.cellContents && tableBody) {
            tableData.cellContents.forEach(cellData => {
                if (cellData.rowIndex >= 0 && tableBody.children[cellData.rowIndex]) {
                    const row = tableBody.children[cellData.rowIndex];
                    if (cellData.colIndex >= 0 && row.children[cellData.colIndex]) {
                        const cell = row.children[cellData.colIndex];
                        if (!cell.classList.contains('waveform-col') && cell.contentEditable === 'true') {
                            cell.innerHTML = cellData.content;
                            if (cellData.isModified) cell.classList.add('modified');
                            else cell.classList.remove('modified');
                        }
                    }
                }
            });
        }

        if (tableData && tableData.metadata) {
            Object.keys(tableData.metadata).forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = tableData.metadata[id] || '';
            });
        }

        restoreSelectionState(tableData);

        // Body style restoration is tricky. Rely on class removal for now.
        // If document.body.className was saved, restore it.
        // document.body.setAttribute('style', originalBodyStyle);

        document.body.offsetHeight; // Force layout
        app.updateStatusMessage('Print cleanup complete.');
    }

    function restoreDrawingLayers() {
        if (!app.Drawing || !app.Drawing.state.layerSystem || !app.Drawing.state.layerSystem.container) {
            return;
        }

        const layerContainer = app.Drawing.state.layerSystem.container;

        if (layerContainer._originalParent !== undefined) { // Check if saved properties exist
            layerContainer.style.display = layerContainer._originalDisplay;
            layerContainer.style.position = layerContainer._originalPos;
            layerContainer.style.top = layerContainer._originalTop;
            layerContainer.style.left = layerContainer._originalLeft;
            layerContainer.style.zIndex = layerContainer._originalZIndex;
            layerContainer.style.width = layerContainer._originalWidth;
            layerContainer.style.height = layerContainer._originalHeight;

            if (layerContainer._originalParent && layerContainer.parentNode !== layerContainer._originalParent) {
                layerContainer._originalParent.appendChild(layerContainer);
            }

            // Clear temporary properties
            delete layerContainer._originalDisplay;
            delete layerContainer._originalPos;
            delete layerContainer._originalTop;
            delete layerContainer._originalLeft;
            delete layerContainer._originalZIndex;
            delete layerContainer._originalWidth;
            delete layerContainer._originalHeight;
            delete layerContainer._originalParent;
            delete layerContainer._tableRef;
        }
        // After restoring, tell the drawing system to resize based on current screen layout
        if (app.Drawing.state.layerSystem.updateLayoutSize) {
            app.Drawing.state.layerSystem.updateLayoutSize();
        }
    }

    // Public API
    app.Export = {
        init,
        exportToPDF,
        printSheet
    };

    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);