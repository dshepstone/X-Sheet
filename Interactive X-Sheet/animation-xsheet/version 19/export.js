

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

    function recalculateDrawingLayerPosition() {
        if (!app.Drawing || !app.Drawing.state.layerSystem) {
            console.warn('Drawing system not available for recalculation.');
            return;
        }

        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;
        const printableArea = document.getElementById('printable-area');
        const table = document.getElementById('xsheet-table');

        if (!table || !printableArea || !layerContainer) {
            console.warn('Required elements not found for drawing layer recalculation.');
            return;
        }

        // Force layout recalculation immediately before measurements
        // This helps ensure getBoundingClientRect provides up-to-date values
        // in the context of the print-mode styles.
        printableArea.offsetHeight; // Reading offsetHeight forces reflow
        table.offsetHeight;

        const tableRect = table.getBoundingClientRect();
        const printableRect = printableArea.getBoundingClientRect();

        // Position the layerContainer relative to the printableArea
        layerContainer.style.position = 'absolute';
        layerContainer.style.top = (tableRect.top - printableRect.top) + 'px';
        layerContainer.style.left = (tableRect.left - printableRect.left) + 'px';
        layerContainer.style.width = tableRect.width + 'px';
        layerContainer.style.height = tableRect.height + 'px';
        layerContainer.style.zIndex = '1000'; // Ensure it's on top for capture
        layerContainer.style.backgroundColor = 'transparent'; // Ensure container is transparent
        layerContainer.style.opacity = '1';
        layerContainer.style.display = 'block'; // Ensure it's visible

        // Resize the actual canvas elements within layerContainer
        // and ensure their context is ready for redrawing.
        let canvasesResized = false;
        layerSystem.layers.forEach(layer => {
            const canvas = layer.canvas;
            canvas.style.backgroundColor = 'transparent'; // CSS style for display
            // Set physical dimensions of the canvas drawing surface
            if (canvas.width !== tableRect.width || canvas.height !== tableRect.height) {
                canvas.width = tableRect.width;
                canvas.height = tableRect.height;
                canvasesResized = true;
            }
            // Ensure context is still valid (might be lost in some scenarios)
            if (!canvas.getContext('2d', { alpha: true })) {
                console.error(`Failed to get 2D context for layer ${layer.name} during export resize.`);
            }
        });

        // Redraw all objects onto the resized canvases ONLY if dimensions changed
        // This uses the object's stored coordinates relative to the new canvas size.
        if (canvasesResized) {
            console.log("Export: Canvases resized, redrawing layers.");
            layerSystem.redrawAll();
        } else {
            console.log("Export: Canvases unchanged, layerSystem.redrawAll() might still be needed if content state changed.");
            // Force redraw anyway for safety during export, as content state (not just size) might differ
            layerSystem.redrawAll();
        }

        console.log('Drawing layer repositioned and redrawn for print mode. Top:', layerContainer.style.top, 'Left:', layerContainer.style.left, 'W:', layerContainer.style.width, 'H:', layerContainer.style.height);
    }


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
        layerContainer._originalWidthCSS = layerContainer.style.width; // Store CSS width/height separately
        layerContainer._originalHeightCSS = layerContainer.style.height;
        layerContainer._originalParent = layerContainer.parentNode;

        layerSystem.layers.forEach(layer => {
            if (layer.canvas) { // Check if canvas exists
                layer.canvas._originalWidthAttr = layer.canvas.width; // Store attribute width/height
                layer.canvas._originalHeightAttr = layer.canvas.height;
            }
        });

        layerContainer.style.display = 'block'; // Make visible for capture

        const printableArea = document.getElementById('printable-area');
        if (printableArea && layerContainer._originalParent !== printableArea) { // Only move if not already there
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
            layerContainer.style.width = layerContainer._originalWidthCSS; // Restore original CSS size
            layerContainer.style.height = layerContainer._originalHeightCSS;

            // Restore physical canvas dimensions
            let needsRedraw = false;
            layerSystem.layers.forEach(layer => {
                if (layer.canvas && layer.canvas._originalWidthAttr !== undefined) { // Check canvas exists
                    if (layer.canvas.width !== layer.canvas._originalWidthAttr || layer.canvas.height !== layer.canvas._originalHeightAttr) {
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

            // Redraw with original dimensions in original location only if size changed
            if (needsRedraw) {
                console.log("Restore: Redrawing layers with original dimensions.");
                layerSystem.redrawAll();
            } else {
                // Even if size didn't change, container might have moved, so a redraw might be needed
                // if object coordinates are relative to the container's visual top/left
                layerSystem.redrawAll();
            }


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
    function cleanupAfterExport(savedData, templateToRestore) { // <<< ADD templateToRestore
        showUIControls();
        // ... (restoreDrawingLayers) ...
        // ... (app.restoreData(savedData)) ...
        // ... (Audio waveform cell redraw) ...

        if (app.updateTemplate && templateToRestore) {
            console.log("Restoring view template to:", templateToRestore);
            app.updateTemplate(templateToRestore); // This calls generateTable if needed
        }
        // Explicitly update drawing layer AFTER template and table are restored
        if (app.Drawing?.state?.layerSystem?.updateLayoutSize) {
            requestAnimationFrame(() => { // Ensure layout changes from updateTemplate are done
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


    function exportToPDF() {
        if (!app.collectData || !app.updateStatusMessage || !app.state || !app.updateTemplate) {
            console.error("PDF Export failed: Core application functions not available.");
            alert("Error: Cannot prepare PDF export."); return;
        }

        const actualViewTemplate = app.state.currentViewTemplate; // <<< SAVE user's current view
        console.log("Pre-PDF export view template:", actualViewTemplate);
        const savedData = app.collectData();
        app.updateStatusMessage('Preparing PDF. Please wait...');

        // >>> For PDF export, temporarily set on-screen layout to 'large' for consistent capture
        console.log("Temporarily setting on-screen layout to 'large' for PDF capture prep.");
        app.updateTemplate('large'); // This ensures a large, predictable area for html2canvas

        // Use requestAnimationFrame to ensure template change (including table regen if frames change) completes
        requestAnimationFrame(() => {
            prepareDrawingLayersForExport();
            if (app.Audio?.drawWaveformInCells) {
                try { app.Audio.drawWaveformInCells(); } catch (err) { console.error("Error in drawWaveformInCells for PDF:", err); }
            }
            hideUIControls();
            document.body.classList.add('print-mode');

            requestAnimationFrame(() => { // Second rAF for styles and drawing layer calc
                document.body.offsetHeight;
                recalculateDrawingLayerPosition();

                setTimeout(() => { // Final delay for rendering
                    const targetElement = document.getElementById('printable-area');
                    if (!targetElement) { /* ... error handling ... */ cleanupAfterExport(savedData, actualViewTemplate); return; }

                    html2canvas(targetElement, { /* ... options ... */ backgroundColor: null })
                        .then(canvas => {
                            // ... (jsPDF logic as before, using 11x17 PDF size) ...
                            const { jsPDF } = window.jspdf;
                            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [279.4, 431.8] }); // Force 11x17 PDF
                            // ... (addImage logic) ...
                            pdf.save(`${app.state.projectName || 'XSheet'}.pdf`);
                            app.updateStatusMessage('PDF exported successfully.');
                        }).catch(err => {
                            console.error('HTML2Canvas or jsPDF error for PDF:', err);
                            app.updateStatusMessage('Error creating PDF: ' + err.message);
                        }).finally(() => {
                            document.body.classList.remove('print-mode');
                            cleanupAfterExport(savedData, actualViewTemplate); // <<< PASS SAVED VIEW
                        });
                }, 400);
            });
        });
    }


    function printSheet() {
        if (!app.updateStatusMessage || !app.state || !app.updateTemplate) {
            console.error("Print failed: Core application functions not available.");
            alert("Error: Cannot prepare for print."); return;
        }
        const actualViewTemplate = app.state.currentViewTemplate; // <<< SAVE user's current view
        console.log("Pre-Print view template:", actualViewTemplate);
        app.updateStatusMessage('Preparing to print. Please wait...');
        const tableData = saveSelectionState();
        const originalBodyStyle = document.body.getAttribute('style') || '';

        // >>> Temporarily set on-screen layout to 'small' for 8.5x11 printing prep
        console.log("Temporarily setting on-screen layout to 'small' for print prep.");
        app.updateTemplate('small'); // This will set wrapper to ~8.5in and regen table if frames change

        requestAnimationFrame(() => {
            prepareDrawingLayersForExport();
            if (app.Audio?.drawWaveformInCells) {
                try { app.Audio.drawWaveformInCells(); } catch (e) { console.error("Error in drawWaveformInCells for print:", e); }
            }
            hideUIControls();
            document.body.classList.add('print-mode');

            requestAnimationFrame(() => {
                document.body.offsetHeight;
                recalculateDrawingLayerPosition();

                setTimeout(() => {
                    console.log("Triggering print dialog for 8.5x11 layout...");
                    try {
                        window.print();
                        setTimeout(() => {
                            document.body.classList.remove('print-mode');
                            cleanupAfterPrint(tableData, originalBodyStyle, actualViewTemplate); // <<< PASS SAVED VIEW
                            if (app.updateStatusMessage) app.updateStatusMessage('Print process finished.');
                        }, 3000);
                    } catch (printError) {
                        console.error("Error during window.print():", printError);
                        if (app.updateStatusMessage) app.updateStatusMessage('Error opening print dialog.');
                        document.body.classList.remove('print-mode');
                        cleanupAfterPrint(tableData, originalBodyStyle, actualViewTemplate); // <<< PASS SAVED VIEW
                    }
                }, 400);
            });
        });
    }


    app.Export = { init, exportToPDF, printSheet };
    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);

