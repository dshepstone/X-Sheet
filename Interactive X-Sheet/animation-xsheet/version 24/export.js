

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
        document.addEventListener('xsheet-export-pdf', exportToPDF);
        document.addEventListener('xsheet-print', printSheet);
    }

    // --- START OF COMPLETE recalculateDrawingLayerPosition FUNCTION for export.js ---

    function recalculateDrawingLayerPosition() {
        if (!app.Drawing?.state?.layerSystem) {
            console.warn('Drawing system not available for recalculation.');
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;
        const printableArea = document.getElementById('printable-area');
        const table = document.getElementById('xsheet-table');

        if (!table || !printableArea || !layerContainer) {
            console.warn('Recalculate: Required elements (table, printableArea, layerContainer) not found.');
            return;
        }

        // Force layout reflow to get correct dimensions after style changes
        printableArea.offsetHeight;
        table.offsetHeight;

        const tableRect = table.getBoundingClientRect();
        const printableRect = printableArea.getBoundingClientRect();

        // Ensure dimensions are valid before proceeding
        if (tableRect.width <= 0 || tableRect.height <= 0) {
            console.warn("Recalculate: Table has zero dimensions. Drawing layer cannot be positioned correctly.", tableRect);
            return;
        }

        // Ensure container is visible
        layerContainer.style.display = 'block';

        // Position the layerContainer relative to the printableArea's coordinate system
        layerContainer.style.position = 'absolute';
        layerContainer.style.top = (tableRect.top - printableRect.top) + 'px';
        layerContainer.style.left = (tableRect.left - printableRect.left) + 'px';
        layerContainer.style.width = tableRect.width + 'px';
        layerContainer.style.height = tableRect.height + 'px';
        layerContainer.style.zIndex = '1000'; // High z-index for capture
        layerContainer.style.backgroundColor = 'transparent'; // Must be transparent
        layerContainer.style.opacity = '1'; // Ensure full opacity

        // Force transparent background with !important by setting the entire style attribute
        layerContainer.setAttribute('style', layerContainer.getAttribute('style') +
            '; background-color: transparent !important' +
            '; opacity: 1 !important' +
            '; z-index: 1000 !important' +
            '; visibility: visible !important');

        let canvasesActuallyResized = false;
        layerSystem.layers.forEach(layer => {
            const canvas = layer.canvas;
            if (!canvas) {
                console.error(`Layer ${layer.name} is missing its canvas element.`);
                return; // Skip this layer if no canvas
            }

            canvas.style.backgroundColor = 'transparent'; // CSS transparency for the element

            // Set physical dimensions of the canvas drawing surface
            if (canvas.width !== tableRect.width || canvas.height !== tableRect.height) {
                canvas.width = tableRect.width;
                canvas.height = tableRect.height;
                canvasesActuallyResized = true;
            }

            // Force transparency for canvases with !important flags
            canvas.setAttribute('style', canvas.getAttribute('style') +
                '; background-color: transparent !important' +
                '; opacity: 1 !important');

            // Ensure context is still valid and configured for alpha transparency
            // Getting context again with alpha:true ensures transparency works
            const ctx = canvas.getContext('2d', { alpha: true });
            if (!ctx) {
                console.error(`Recalculate: Failed to get 2D context (alpha:true) for layer ${layer.name}`);
            } else {
                // Force the context to be transparent too
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'source-over';
            }
        });

        // ALWAYS REDRAW for export/print preparation
        console.log(`Recalculate: Forcing redraw of all drawing layers. Canvases resized: ${canvasesActuallyResized}`);
        layerSystem.redrawAll();

        console.log('Drawing layer repositioned & redrawn for export/print. Top:', layerContainer.style.top,
            'Left:', layerContainer.style.left, 'W:', layerContainer.style.width,
            'H:', layerContainer.style.height);
    }

    // --- END OF COMPLETE recalculateDrawingLayerPosition FUNCTION ---


    function prepareDrawingLayersForExport() {
        if (!app.Drawing || !app.Drawing.state.layerSystem) {
            console.warn('Drawing system not available for export preparation.');
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;

        if (!layerContainer) {
            console.error("prepareDrawingLayersForExport: Layer container not found.");
            return;
        }

        // Save original CSS, DOM parent, and canvas dimensions
        layerContainer._originalDisplay = layerContainer.style.display;
        layerContainer._originalPos = layerContainer.style.position;
        layerContainer._originalTop = layerContainer.style.top;
        layerContainer._originalLeft = layerContainer.style.left;
        layerContainer._originalZIndex = layerContainer.style.zIndex;
        layerContainer._originalWidthCSS = layerContainer.style.width;
        layerContainer._originalHeightCSS = layerContainer.style.height;
        layerContainer._originalParent = layerContainer.parentNode;

        layerSystem.layers.forEach(layer => {
            if (layer.canvas) {
                layer.canvas._originalWidthAttr = layer.canvas.width;
                layer.canvas._originalHeightAttr = layer.canvas.height;
                // Ensure transparency is set
                layer.canvas.style.backgroundColor = 'transparent';
            }
        });

        layerContainer.style.display = 'block'; // Make visible for capture
        layerContainer.style.backgroundColor = 'transparent'; // Ensure transparency

        const printableArea = document.getElementById('printable-area');
        if (printableArea && layerContainer._originalParent !== printableArea) {
            console.log("Moving drawing layer container to printable area.");
            printableArea.appendChild(layerContainer);
        } else if (!printableArea) {
            console.error("Printable area not found for moving drawing layer.");
            return;
        }
        console.log('Drawing layers prepared for export.');
    }

    function restoreDrawingLayers() {
        if (!app.Drawing || !app.Drawing.state.layerSystem) {
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;

        if (!layerContainer) {
            console.error("restoreDrawingLayers: Layer container not found.");
            return;
        }

        // Only restore if we saved original values and have a parent to return to
        if (layerContainer._originalParent) {
            layerContainer.style.display = layerContainer._originalDisplay;
            layerContainer.style.position = layerContainer._originalPos;
            layerContainer.style.top = layerContainer._originalTop;
            layerContainer.style.left = layerContainer._originalLeft;
            layerContainer.style.zIndex = layerContainer._originalZIndex;
            layerContainer.style.width = layerContainer._originalWidthCSS;
            layerContainer.style.height = layerContainer._originalHeightCSS;

            // Restore physical canvas dimensions
            let needsRedraw = false;
            layerSystem.layers.forEach(layer => {
                if (layer.canvas && layer.canvas._originalWidthAttr !== undefined) {
                    if (layer.canvas.width !== layer.canvas._originalWidthAttr ||
                        layer.canvas.height !== layer.canvas._originalHeightAttr) {
                        layer.canvas.width = layer.canvas._originalWidthAttr;
                        layer.canvas.height = layer.canvas._originalHeightAttr;
                        needsRedraw = true;
                    }
                    delete layer.canvas._originalWidthAttr;
                    delete layer.canvas._originalHeightAttr;
                }
            });

            // Move back to original parent
            if (layerContainer.parentNode !== layerContainer._originalParent) {
                layerContainer._originalParent.appendChild(layerContainer);
            }

            // Redraw to ensure everything is displayed correctly
            layerSystem.redrawAll();

            // Clear temporary properties
            delete layerContainer._originalDisplay;
            delete layerContainer._originalPos;
            delete layerContainer._originalTop;
            delete layerContainer._originalLeft;
            delete layerContainer._originalZIndex;
            delete layerContainer._originalWidthCSS;
            delete layerContainer._originalHeightCSS;
            delete layerContainer._originalParent;
            console.log('Drawing layers restored to original state.');
        } else {
            console.warn("restoreDrawingLayers: No original parent found, skipping restore.");
        }
    }


    function hideUIControls() {
        const elements = [
            document.querySelector('.controls'),
            document.querySelector('#audio-controls'),
            document.querySelector('.status'),
            document.querySelector('#phonetic-input'),
            document.querySelector('#drawing-toolbar-container') // Hide the container
        ];
        elements.forEach(element => {
            if (element) element.style.display = 'none';
        });
    }

    function showUIControls() {
        const elements = [
            { el: document.querySelector('.controls'), display: 'flex' },
            { el: document.querySelector('#audio-controls'), display: 'flex' },
            { el: document.querySelector('.status'), display: 'block' },
            { el: document.querySelector('#drawing-toolbar-container'), display: 'block' }
        ];
        elements.forEach(item => {
            if (item.el) item.el.style.display = item.display;
        });
    }

    function saveSelectionState() {
        const selectedCells = document.querySelectorAll('.selected-cell');
        const tableData = {
            selectedIndices: Array.from(selectedCells).map(cell => {
                const row = cell.closest('tr');
                const tableBody = document.getElementById('xsheet-body');
                const rowIndex = tableBody ? Array.from(tableBody.children).indexOf(row) : -1;
                const colIndex = row ? Array.from(row.children).indexOf(cell) : -1;
                return { rowIndex, colIndex };
            }),
            metadata: {
                projectNumber: document.getElementById('project-number').value,
                date: document.getElementById('project-date').value,
                pageNumber: document.getElementById('page-number').value,
                animatorName: document.getElementById('animator-name').value,
                versionNumber: document.getElementById('version-number').value,
                shotNumber: document.getElementById('shot-number').value
            },
            cellContents: []
        };
        // Save original content of waveform cells (which will be canvases)
        document.querySelectorAll('#xsheet-body .waveform-col').forEach(cell => {
            cell.setAttribute('data-original-content', cell.innerHTML);
        });
        // Save content of all editable cells
        document.querySelectorAll('#xsheet-body [contenteditable="true"]').forEach(cell => {
            const row = cell.closest('tr');
            if (row) {
                const tableBody = document.getElementById('xsheet-body');
                const rowIndex = tableBody ? Array.from(tableBody.children).indexOf(row) : -1;
                const colIndex = Array.from(row.children).indexOf(cell);
                if (rowIndex !== -1 && colIndex !== -1) {
                    tableData.cellContents.push({
                        rowIndex, colIndex, content: cell.innerHTML,
                        isModified: cell.classList.contains('modified')
                    });
                }
            }
        });
        return tableData;
    }

    function restoreSelectionState(tableData) {
        if (!tableData || !tableData.selectedIndices) return;
        if (app.clearCellSelection && typeof app.clearCellSelection === 'function') {
            app.clearCellSelection();
        } else {
            console.error("restoreSelectionState: app.clearCellSelection is not available.");
        }
        const tableBody = document.getElementById('xsheet-body');
        if (!tableBody) return;

        // Reset app's internal selection state if necessary
        if (app.state && app.state.selectedCells) {
            app.state.selectedCells = [];
        }

        tableData.selectedIndices.forEach(index => {
            if (index.rowIndex >= 0 && index.rowIndex < tableBody.children.length) {
                const row = tableBody.children[index.rowIndex];
                if (index.colIndex >= 0 && index.colIndex < row.children.length) {
                    const cell = row.children[index.colIndex];
                    if (cell && cell.classList && cell.contentEditable === 'true') {
                        cell.classList.add('selected-cell');
                        // Also update the app.state.selectedCells array if it's used for other logic
                        if (app.state?.selectedCells && !app.state.selectedCells.includes(cell)) {
                            app.state.selectedCells.push(cell);
                        }
                    }
                }
            }
        });
    }

    // In export.js
    function cleanupAfterExport(savedData, templateToRestore) {
        showUIControls();
        restoreDrawingLayers();

        // Restore the original data
        app.restoreData(savedData);

        // Restore the original template if provided
        if (app.updateTemplate && templateToRestore) {
            console.log("Restoring view template to:", templateToRestore);
            app.updateTemplate(templateToRestore);
        }

        // Explicitly update drawing layer AFTER template and table are restored
        if (app.Drawing?.state?.layerSystem?.updateLayoutSize) {
            requestAnimationFrame(() => {
                if (app.Drawing?.state?.layerSystem) {
                    app.Drawing.state.layerSystem.updateLayoutSize();
                }
            });
        }
        console.log("Export cleanup finished.");
    }


    function cleanupAfterPrint(tableData, originalBodyStyle, templateToRestore) { // <<< ADD templateToRestore
        showUIControls();
        // ... (restore live waveform container, drawing layers, metadata, cell contents) ...

        if (app.updateTemplate && templateToRestore) {
            console.log("Restoring view template to:", templateToRestore);
            app.updateTemplate(templateToRestore);
        }
        if (app.Drawing?.state?.layerSystem?.updateLayoutSize) {
            requestAnimationFrame(() => {
                if (app.Drawing?.state?.layerSystem) {
                    app.Drawing.state.layerSystem.updateLayoutSize();
                }
            });
        }
        console.log("Print cleanup finished.");
    }


    function cleanupAfterPrint(tableData, originalBodyStyle) {
        showUIControls();
        const liveWaveformContainer = document.querySelector('.waveform-container'); // Live one
        if (liveWaveformContainer) liveWaveformContainer.style.display = '';

        restoreDrawingLayers();

        // Restore metadata fields first
        if (tableData?.metadata) {
            document.getElementById('project-number').value = tableData.metadata.projectNumber || '';
            document.getElementById('project-date').value = tableData.metadata.date || '';
            document.getElementById('page-number').value = tableData.metadata.pageNumber || '';
            document.getElementById('animator-name').value = tableData.metadata.animatorName || '';
            document.getElementById('version-number').value = tableData.metadata.versionNumber || '';
            document.getElementById('shot-number').value = tableData.metadata.shotNumber || '';
        }

        // Restore cell contents for editable cells
        if (tableData?.cellContents) {
            const tableBody = document.getElementById('xsheet-body');
            if (tableBody) {
                tableData.cellContents.forEach(cellData => {
                    if (cellData.rowIndex >= 0 && cellData.rowIndex < tableBody.children.length) {
                        const row = tableBody.children[cellData.rowIndex];
                        if (cellData.colIndex >= 0 && cellData.colIndex < row.children.length) {
                            const cell = row.children[cellData.colIndex];
                            if (cell?.contentEditable === 'true' && !cell.classList.contains('waveform-col')) {
                                cell.innerHTML = cellData.content;
                                cell.classList.toggle('modified', cellData.isModified);
                            }
                        }
                    }
                });
            }
        }

        // Restore original content of waveform cells (which were turned into canvases for print)
        // This ensures they are ready for the live waveform or next drawWaveformInCells
        document.querySelectorAll('#xsheet-body .waveform-col').forEach(cell => {
            const originalContent = cell.getAttribute('data-original-content');
            if (originalContent !== null) {
                cell.innerHTML = originalContent;
                cell.removeAttribute('data-original-content');
            } else {
                cell.innerHTML = ''; // Default to empty if no original saved
            }
        });


        restoreSelectionState(tableData);
        document.body.setAttribute('style', originalBodyStyle);
        document.body.offsetHeight; // Force reflow
        console.log("Print cleanup finished.");
    }


    // --- START OF REPLACEMENT CODE FOR export.js FUNCTIONS ---

    async function exportToPDF() {
        if (!app.collectData || !app.updateStatusMessage || !app.state || !app.updateTemplate) {
            console.error("PDF Export failed: Core application functions not available.");
            if (app.updateStatusMessage) app.updateStatusMessage("Error: PDF Export unavailable.");
            else alert("Error: Cannot prepare PDF export. Application state is missing.");
            return;
        }

        // Store the current view template to restore later
        const actualViewTemplate = app.state.currentViewTemplate || 'fullpage';
        console.log("Pre-PDF export view template:", actualViewTemplate);

        // Collect all current data to restore after export
        const savedData = app.collectData();
        app.updateStatusMessage('Preparing PDF (1/4)...');

        // Phase 1: Set to small template for export (8.5x11)
        console.log("PDF: Temporarily setting on-screen layout to 'small'.");
        await new Promise(resolve => {
            app.updateTemplate('small'); // Always use small (8.5x11) for PDF export
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        app.updateStatusMessage('Preparing PDF (2/4)...');

        // Phase 2: Prepare layers and UI for export mode
        prepareDrawingLayersForExport();
        if (app.Audio?.drawWaveformInCells) {
            try { app.Audio.drawWaveformInCells(); }
            catch (err) { console.error("PDF: Error in drawWaveformInCells:", err); }
        }
        hideUIControls();
        document.body.classList.add('print-mode');
        app.updateStatusMessage('Preparing PDF (3/4)...');

        // Phase 3: Recalculate and Redraw Drawing Layer for the Export Layout
        await new Promise(resolve => {
            requestAnimationFrame(() => {
                document.body.offsetHeight; // Force reflow
                console.log("PDF: Recalculating drawing layer position for export.");
                recalculateDrawingLayerPosition();
                requestAnimationFrame(resolve);
            });
        });
        app.updateStatusMessage('Preparing PDF (4/4 Capturing)...');

        // Phase 4: Capture with html2canvas
        setTimeout(async () => {
            const targetElement = document.getElementById('printable-area');
            if (!targetElement) {
                console.error("PDF Export failed: Printable area not found.");
                app.updateStatusMessage('Error creating PDF: Printable area missing.');
                document.body.classList.remove('print-mode');
                cleanupAfterExport(savedData, actualViewTemplate);
                return;
            }

            try {
                console.log("PDF: Starting html2canvas capture...");
                const canvasOutput = await html2canvas(targetElement, {
                    scale: 1.5,
                    useCORS: true,
                    logging: false,
                    allowTaint: true,
                    backgroundColor: null, // Critical for transparency
                    imageTimeout: 15000,
                    removeContainer: true
                });

                console.log("PDF: html2canvas capture successful.");
                const imgData = canvasOutput.toDataURL('image/png');
                if (!imgData || imgData === 'data:,') {
                    throw new Error("html2canvas returned empty image data.");
                }

                const { jsPDF } = window.jspdf;
                // PDF output is always targeted for 8.5x11 (letter size)
                const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
                const imgProps = pdf.getImageProperties(imgData);
                const margin = 10; // mm
                const pdfPageWidth = pdf.internal.pageSize.getWidth() - (margin * 2);
                const pdfPageHeight = pdf.internal.pageSize.getHeight() - (margin * 2);
                const ratio = Math.min(pdfPageWidth / imgProps.width, pdfPageHeight / imgProps.height);
                const imgFinalWidth = imgProps.width * ratio;
                const imgFinalHeight = imgProps.height * ratio;

                pdf.addImage(imgData, 'PNG', margin, margin, imgFinalWidth, imgFinalHeight);
                pdf.save(`${app.state.projectName || 'XSheet'}.pdf`);
                app.updateStatusMessage('PDF exported successfully.');

            } catch (err) {
                console.error('Error during PDF generation or html2canvas:', err);
                app.updateStatusMessage('Error creating PDF: ' + err.message);
            } finally {
                console.log("PDF: Starting cleanup sequence.");
                document.body.classList.remove('print-mode');
                // Pass the original template to restore it
                cleanupAfterExport(savedData, actualViewTemplate);
            }
        }, 500);
    }


    async function printSheet() {
        if (!app.updateStatusMessage || !app.state || !app.updateTemplate) {
            console.error("Print failed: Core application functions not available.");
            if (app.updateStatusMessage) app.updateStatusMessage("Error: Print unavailable.");
            else alert("Error: Cannot prepare for print.");
            return;
        }

        const actualViewTemplate = app.state.currentViewTemplate;
        console.log("Pre-Print view template:", actualViewTemplate);
        app.updateStatusMessage('Preparing to print (1/4)...');
        const tableData = saveSelectionState();
        const originalBodyStyle = document.body.getAttribute('style') || '';

        // Phase 1: Set up on-screen layout for print (e.g., 'small' for 8.5x11)
        console.log("Print: Temporarily setting on-screen layout to 'small'.");
        await new Promise(resolve => {
            app.updateTemplate('small'); // Sets wrapper to ~8.5in, might regen table
            requestAnimationFrame(() => requestAnimationFrame(resolve)); // Double rAF for stability
        });
        app.updateStatusMessage('Preparing to print (2/4)...');

        // Phase 2: Prepare layers and UI for print mode
        prepareDrawingLayersForExport();
        if (app.Audio?.drawWaveformInCells) {
            try { app.Audio.drawWaveformInCells(); }
            catch (e) { console.error("Print: Error in drawWaveformInCells:", e); }
        }
        hideUIControls();

        // Apply special print mode styling with better control to prevent page breaks
        document.body.classList.add('print-mode');

        // Set specific print styles to prevent pagination issues
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.body.style.overflow = 'visible';

        const printableArea = document.getElementById('printable-area');
        if (printableArea) {
            printableArea.style.margin = '0 auto';
            printableArea.style.padding = '0';
            printableArea.style.width = '8.5in';
            printableArea.style.maxWidth = '8.5in';
            printableArea.style.pageBreakInside = 'avoid';
            printableArea.style.pageBreakBefore = 'auto';
            printableArea.style.pageBreakAfter = 'auto';
            // Ensure all child elements stay together
            printableArea.style.display = 'inline-block';
        }

        const xsheetTable = document.getElementById('xsheet-table');
        if (xsheetTable) {
            xsheetTable.style.margin = '0';
            xsheetTable.style.pageBreakInside = 'avoid';
            xsheetTable.style.transform = 'translateZ(0)'; // Force composition layer
        }

        // Fix header and metadata spacing to prevent page breaks
        const header = document.querySelector('.header');
        if (header) {
            header.style.marginBottom = '0';
            header.style.pageBreakAfter = 'avoid';
        }

        const metadata = document.querySelector('.metadata');
        if (metadata) {
            metadata.style.marginBottom = '0';
            metadata.style.pageBreakAfter = 'avoid';
            metadata.style.pageBreakBefore = 'avoid';
        }

        app.updateStatusMessage('Preparing to print (3/4)...');

        // Phase 3: Recalculate and Redraw Drawing Layer for Print Layout
        await new Promise(resolve => {
            requestAnimationFrame(() => {
                document.body.offsetHeight; // Force reflow
                console.log("Print: Recalculating drawing layer position for print.");
                recalculateDrawingLayerPosition();
                requestAnimationFrame(resolve);
            });
        });
        app.updateStatusMessage('Opening print dialog (4/4)...');

        // Phase 4: Trigger Print Dialog
        setTimeout(() => {
            console.log("Print: Triggering window.print().");
            try {
                window.print();
                // Cleanup is deferred due to blocking nature of print()
                setTimeout(() => {
                    console.log("Print: Attempting post-print cleanup.");
                    document.body.classList.remove('print-mode');
                    cleanupAfterPrint(tableData, originalBodyStyle, actualViewTemplate);
                    if (app.updateStatusMessage) app.updateStatusMessage('Print process finished.');
                }, 1000); // Shorter delay for cleanup
            } catch (printError) {
                console.error("Error during window.print():", printError);
                if (app.updateStatusMessage) app.updateStatusMessage('Error opening print dialog.');
                document.body.classList.remove('print-mode');
                cleanupAfterPrint(tableData, originalBodyStyle, actualViewTemplate);
            }
        }, 300); // Shorter delay before print()
    }

    function recalculateDrawingLayerPosition() {
        if (!app.Drawing?.state?.layerSystem) {
            console.warn('Drawing system not available for recalculation.');
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;
        const printableArea = document.getElementById('printable-area');
        const table = document.getElementById('xsheet-table');

        if (!table || !printableArea || !layerContainer) {
            console.warn('Recalculate: Required elements (table, printableArea, layerContainer) not found.');
            return;
        }

        // Force layout reflow to get correct dimensions after style changes
        printableArea.offsetHeight;
        table.offsetHeight;

        const tableRect = table.getBoundingClientRect();
        const printableRect = printableArea.getBoundingClientRect();

        // Ensure dimensions are valid before proceeding
        if (tableRect.width <= 0 || tableRect.height <= 0) {
            console.warn("Recalculate: Table has zero dimensions. Drawing layer cannot be positioned correctly.", tableRect);
            return;
        }

        // Ensure container is visible and properly positioned
        layerContainer.style.display = 'block';
        layerContainer.style.position = 'absolute';
        layerContainer.style.top = (tableRect.top - printableRect.top) + 'px';
        layerContainer.style.left = (tableRect.left - printableRect.left) + 'px';
        layerContainer.style.width = tableRect.width + 'px';
        layerContainer.style.height = tableRect.height + 'px';
        layerContainer.style.zIndex = '1000'; // High z-index for visibility in print
        layerContainer.style.backgroundColor = 'transparent';
        layerContainer.style.opacity = '1';
        layerContainer.style.visibility = 'visible';

        // Force transparent background with !important
        layerContainer.setAttribute('style', layerContainer.getAttribute('style') +
            '; background-color: transparent !important' +
            '; opacity: 1 !important' +
            '; z-index: 1000 !important' +
            '; visibility: visible !important');

        let canvasesActuallyResized = false;
        layerSystem.layers.forEach(layer => {
            const canvas = layer.canvas;
            if (!canvas) {
                console.error(`Layer ${layer.name} is missing its canvas element.`);
                return; // Skip this layer if no canvas
            }

            canvas.style.backgroundColor = 'transparent'; // CSS transparency for the element

            // Set physical dimensions of the canvas drawing surface
            if (canvas.width !== tableRect.width || canvas.height !== tableRect.height) {
                canvas.width = tableRect.width;
                canvas.height = tableRect.height;
                canvasesActuallyResized = true;
            }

            // Force transparency for canvases with !important flags
            canvas.setAttribute('style', canvas.getAttribute('style') +
                '; background-color: transparent !important' +
                '; opacity: 1 !important');

            // Ensure context is still valid and configured for alpha transparency
            // Getting context again with alpha:true ensures transparency works
            const ctx = canvas.getContext('2d', { alpha: true });
            if (!ctx) {
                console.error(`Recalculate: Failed to get 2D context (alpha:true) for layer ${layer.name}`);
            } else {
                // Force the context to be transparent too
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'source-over';
            }
        });

        // ALWAYS REDRAW for export/print preparation
        console.log(`Recalculate: Forcing redraw of all drawing layers.`);
        layerSystem.redrawAll();
    }

    // --- END OF REPLACEMENT CODE FOR export.js FUNCTIONS ---


    app.Export = { init, exportToPDF, printSheet };
    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);

