/**
 * export.js - Export and printing functionality for Animation X-Sheet
 * Handles PDF export and printing with improved reliability
 */

window.XSheetApp = window.XSheetApp || {};
window.XSheetApp.Export = window.XSheetApp.Export || {};

(function (app) {
    'use strict';

    let isExportingPDF = false;
    let isPrinting = false;

    function init() {
        document.removeEventListener('xsheet-export-pdf', handleExportPDFEvent);
        document.addEventListener('xsheet-export-pdf', handleExportPDFEvent);

        document.removeEventListener('xsheet-print', handlePrintEvent);
        document.addEventListener('xsheet-print', handlePrintEvent);
    }

    function handleExportPDFEvent() {
        if (isExportingPDF) {
            console.warn("PDF export already in progress.");
            return;
        }
        isExportingPDF = true;
        exportToPDF().finally(() => {
            isExportingPDF = false;
        });
    }

    function handlePrintEvent() {
        if (isPrinting) {
            console.warn("Print operation already in progress.");
            return;
        }
        isPrinting = true;
        printSheet();
    }

    async function exportToPDF() {
        app.updateStatusMessage('Preparing PDF. Please wait...');
        const savedData = app.collectData();
        const printableElement = document.getElementById('printable-area');
        const originalPrintableStyle = printableElement.getAttribute('style') || '';

        document.body.classList.add('print-mode');
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        // PrepareForExport populates audio waveforms, which can change table height.
        // It also moves the drawing layer.
        prepareForExport();

        // After DOM changes from prepareForExport, wait for render and then recalculate.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        recalculateDrawingLayerPosition(false, 'pdf'); // context 'pdf'

        return new Promise((resolve, reject) => {
            setTimeout(async () => { // Timeout for html2canvas
                try {
                    const canvas = await html2canvas(printableElement, {
                        scale: 1.5,
                        useCORS: true,
                        logging: false,
                        allowTaint: true,
                        backgroundColor: '#ffffff',
                        scrollX: 0,
                        scrollY: 0,
                        windowWidth: document.documentElement.scrollWidth,
                        windowHeight: document.documentElement.scrollHeight
                    });

                    const imgData = canvas.toDataURL('image/png');
                    const { jsPDF } = window.jspdf;
                    const pdfWidth = 215.9, pdfHeight = 279.4, margin = 10;
                    const contentWidth = pdfWidth - (2 * margin);
                    const contentHeight = pdfHeight - (2 * margin);
                    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
                    const imgProps = pdf.getImageProperties(imgData);
                    const pixelsPerPdfPage = contentHeight * (imgProps.width / contentWidth);
                    const numPages = Math.ceil(imgProps.height / pixelsPerPdfPage);

                    for (let i = 0; i < numPages; i++) {
                        if (i > 0) pdf.addPage();
                        let sourceImgSliceY = i * pixelsPerPdfPage;
                        let sourceImgSliceHeight = Math.min(pixelsPerPdfPage, imgProps.height - sourceImgSliceY);
                        if (sourceImgSliceHeight <= 0) continue;

                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = imgProps.width;
                        tempCanvas.height = sourceImgSliceHeight;
                        const tempCtx = tempCanvas.getContext('2d');
                        tempCtx.drawImage(canvas, 0, sourceImgSliceY, imgProps.width, sourceImgSliceHeight, 0, 0, imgProps.width, sourceImgSliceHeight);

                        const pageImgData = tempCanvas.toDataURL('image/png');
                        const actualSlicePdfHeight = sourceImgSliceHeight * (contentWidth / imgProps.width);
                        pdf.addImage(pageImgData, 'PNG', margin, margin, contentWidth, actualSlicePdfHeight);
                    }

                    pdf.save(`${app.state.projectName || 'XSheet'}.pdf`);
                    app.updateStatusMessage('PDF exported successfully.');
                    resolve();
                } catch (err) {
                    console.error('Error during PDF creation or saving:', err);
                    app.updateStatusMessage('Error creating PDF: ' + err.message);
                    reject(err);
                } finally {
                    document.body.classList.remove('print-mode');
                    printableElement.setAttribute('style', originalPrintableStyle);
                    cleanupAfterExport(savedData);
                }
            }, 200);
        });
    }

    function printSheet() {
        app.updateStatusMessage('Preparing to print. Please wait...');
        const tableData = saveSelectionState();
        const originalBodyClassName = document.body.className;

        document.body.classList.add('print-mode');

        requestAnimationFrame(() => {
            requestAnimationFrame(async () => {
                prepareForExport();
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                recalculateDrawingLayerPosition(true, 'print');
                setTimeout(() => {
                    window.print();
                }, 50);
            });
        });

        const cleanup = () => {
            document.body.classList.remove('print-mode');
            document.body.className = originalBodyClassName;
            cleanupAfterPrint(tableData); // This will call restoreDrawingLayers
            app.updateStatusMessage('Print job sent.');
            window.removeEventListener('afterprint', cleanup);
            document.removeEventListener('keyup', escapeListener);
            isPrinting = false;
        };
        const escapeListener = (e) => { if (e.key === "Escape") cleanup(); };
        if (window.onafterprint !== undefined) {
            window.addEventListener('afterprint', cleanup, { once: true });
        } else {
            setTimeout(cleanup, 3000);
        }
        setTimeout(() => { document.addEventListener('keyup', escapeListener, { once: true }); }, 200);
    }

    function prepareForExport() {
        // This function can modify the DOM and thus table dimensions (e.g. audio waveforms)
        // It should be called AFTER .print-mode styles are applied and BEFORE final position calculation.
        if (app.Audio && app.Audio.state.audioBuffer && app.Audio.state.waveformData.length > 0) {
            app.Audio.drawWaveformInCells();
        }
        prepareDrawingLayersForExport(); // This moves the drawing layer to be a child of printableArea
    }

    function prepareDrawingLayersForExport() {
        if (!app.Drawing || !app.Drawing.state.layerSystem || !app.Drawing.state.layerSystem.container) {
            return;
        }
        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;
        if (layerContainer._originalParent === undefined) {
            // Save original state
            layerContainer._originalDisplay = layerContainer.style.display;
            layerContainer._originalPos = layerContainer.style.position;
            layerContainer._originalTop = layerContainer.style.top;
            layerContainer._originalLeft = layerContainer.style.left;
            layerContainer._originalZIndex = layerContainer.style.zIndex;
            layerContainer._originalWidth = layerContainer.style.width;
            layerContainer._originalHeight = layerContainer.style.height;
            layerContainer._originalParent = layerContainer.parentNode;
        }
        layerContainer.style.display = 'block'; // Ensure visible for capture
        const printableArea = document.getElementById('printable-area');
        if (layerContainer.parentNode !== printableArea) {
            printableArea.appendChild(layerContainer); // Move to printable area
        }
        layerContainer._tableRef = document.getElementById('xsheet-table'); // Store table reference
    }

    function recalculateDrawingLayerPosition(isForPrint = false, context = 'screen') {
        if (!app.Drawing || !app.Drawing.state.layerSystem || !app.Drawing.state.layerSystem.container) {
            return;
        }
        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;
        const table = layerContainer._tableRef || document.getElementById('xsheet-table');
        const printableArea = document.getElementById('printable-area');

        if (!table || !printableArea) {
            console.warn("RecalculateDrawingLayerPosition: Missing table or printableArea for context:", context);
            return;
        }
        if (layerContainer.parentNode !== printableArea) {
            printableArea.appendChild(layerContainer);
            printableArea.offsetHeight;
        }

        // Force a reflow of the table right before getting its dimensions
        // This is crucial if prepareForExport (e.g., adding audio waveforms) changed its height.
        table.offsetHeight;

        const tableRect = table.getBoundingClientRect();
        const printableAreaRect = printableArea.getBoundingClientRect();

        let topPos = tableRect.top - printableAreaRect.top;
        let leftPos = tableRect.left - printableAreaRect.left;

        // Use the measured width and height from getBoundingClientRect for the drawing layer
        let newWidth = tableRect.width;
        let newHeight = tableRect.height;

        console.log(`[${context.toUpperCase()}] Rects: TableTop: ${tableRect.top.toFixed(2)}, TableHeight: ${tableRect.height.toFixed(2)}, PrintableAreaTop: ${printableAreaRect.top.toFixed(2)}, Calc Top: ${topPos.toFixed(2)}`);

        const hasAudio = !!(app.Audio && app.Audio.state.audioBuffer && app.Audio.state.waveformData.length > 0);
        console.log(`[${context.toUpperCase()}] Audio present: ${hasAudio}`);

        if (context === 'print') {
            // If drawing appears too HIGH by X pixels, ADD X to topPos to move it DOWN.
            topPos += 9; // YOUR SHIM VALUE FOR PRINT
            console.log(`[PRINT] Adjusted topPos: ${topPos.toFixed(2)} (shim for print applied)`);
        } else if (context === 'pdf') {
            if (hasAudio) {
                // topPos += 0; // If audio makes it nearly correct, maybe no shim or a very small one
                console.log(`[PDF with Audio] topPos: ${topPos.toFixed(2)} (no shim applied)`);
            } else { // No audio
                // If drawing is significantly off WITHOUT audio, apply a different shim
                // Example: If drawing is 20px too high without audio
                topPos += 15; // SHIM FOR PDF WITHOUT AUDIO
                console.log(`[PDF no Audio] Adjusted topPos: ${topPos.toFixed(2)} (shim for no audio applied)`);
            }
        }

        layerContainer.style.position = 'absolute';
        layerContainer.style.top = topPos + 'px';
        layerContainer.style.left = leftPos + 'px';
        // Set drawing layer container height explicitly from measured table height
        layerContainer.style.width = newWidth + 'px';
        layerContainer.style.height = newHeight + 'px';

        // Also resize the canvases within the drawing layer system
        if (layerSystem && typeof layerSystem.updateLayoutSize === 'function') {
            // We pass the new dimensions so it can resize its internal canvases
            layerSystem.updateLayoutSize(newWidth, newHeight);
        } else if (layerSystem && layerSystem.layers) { // Fallback if updateLayoutSize is not refactored yet
            layerSystem.layers.forEach(layer => {
                if (layer.canvas) {
                    layer.canvas.width = newWidth;
                    layer.canvas.height = newHeight;
                }
            });
            if (typeof layerSystem.redrawAll === 'function') layerSystem.redrawAll();
        }
        layerContainer.style.zIndex = '10';
    }

    // --- saveSelectionState, restoreSelectionState, cleanupAfterExport, cleanupAfterPrint, restoreDrawingLayers ---
    // These functions remain largely the same as the previous complete version.
    function saveSelectionState() {
        const selectedCells = Array.from(document.querySelectorAll('.selected-cell'));
        const tableData = {
            selectedIndices: selectedCells.map(cell => {
                const row = cell.closest('tr');
                const body = document.getElementById('xsheet-body');
                const rowIndex = row && body ? Array.from(body.children).indexOf(row) : -1;
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
            cell.setAttribute('data-original-content', cell.innerHTML);
        });

        const allEditableCells = document.querySelectorAll('[contenteditable="true"]');
        const tableBodyForContent = document.getElementById('xsheet-body');
        if (tableBodyForContent) {
            allEditableCells.forEach(cell => {
                const row = cell.closest('tr');
                if (row && row.parentNode === tableBodyForContent) {
                    const rowIndex = Array.from(tableBodyForContent.children).indexOf(row);
                    const colIndex = Array.from(row.children).indexOf(cell);
                    tableData.cellContents.push({
                        rowIndex,
                        colIndex,
                        content: cell.innerHTML,
                        isModified: cell.classList.contains('modified')
                    });
                }
            });
        }

        return tableData;
    }

    function restoreSelectionState(tableData) {
        if (!tableData || !tableData.selectedIndices) return;

        if (app.clearCellSelection) app.clearCellSelection();

        const tableBody = document.getElementById('xsheet-body');
        if (!tableBody) return;

        tableData.selectedIndices.forEach(index => {
            if (index.rowIndex >= 0 && index.rowIndex < tableBody.children.length && tableBody.children[index.rowIndex]) {
                const row = tableBody.children[index.rowIndex];
                if (index.colIndex >= 0 && index.colIndex < row.children.length && row.children[index.colIndex]) {
                    const cell = row.children[index.colIndex];
                    if (cell.contentEditable === 'true') {
                        if (app.XSheetApp && app.XSheetApp.state && app.XSheetApp.state.selectedCells) {
                            app.XSheetApp.state.selectedCells.push(cell);
                        }
                        cell.classList.add('selected-cell');
                    }
                }
            }
        });
    }

    function cleanupAfterExport(savedData) {
        document.body.classList.remove('print-mode');

        if (app.restoreData && savedData) {
            app.restoreData(savedData);
        }
        restoreDrawingLayers();
        app.updateStatusMessage("Export cleanup complete.");
    }

    function cleanupAfterPrint(tableData) {
        // document.body.classList.remove('print-mode'); // Done in printSheet's cleanup
        // document.body.className = originalBodyClassName; // Done in printSheet's cleanup

        if (tableData) {
            const tableBody = document.getElementById('xsheet-body');
            const waveformCells = document.querySelectorAll('.waveform-col');
            waveformCells.forEach(cell => {
                const originalContent = cell.getAttribute('data-original-content');
                if (originalContent !== null) {
                    cell.innerHTML = originalContent;
                    cell.removeAttribute('data-original-content');
                }
            });
            if (tableData.cellContents && tableBody) {
                tableData.cellContents.forEach(cellData => {
                    if (cellData.rowIndex >= 0 && cellData.rowIndex < tableBody.children.length) {
                        const row = tableBody.children[cellData.rowIndex];
                        if (row && cellData.colIndex >= 0 && cellData.colIndex < row.children.length) {
                            const cell = row.children[cellData.colIndex];
                            if (cell && !cell.classList.contains('waveform-col') && cell.contentEditable === 'true') {
                                cell.innerHTML = cellData.content;
                                if (cellData.isModified) cell.classList.add('modified');
                                else cell.classList.remove('modified');
                            }
                        }
                    }
                });
            }
            if (tableData.metadata) {
                Object.keys(tableData.metadata).forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = tableData.metadata[id] || '';
                });
            }
            restoreSelectionState(tableData);
        }

        restoreDrawingLayers();
        // document.body.offsetHeight;  // Reflow after all restorations
        app.updateStatusMessage('Print operation finished.');
    }

    function restoreDrawingLayers() {
        if (!app.Drawing || !app.Drawing.state.layerSystem || !app.Drawing.state.layerSystem.container) {
            return;
        }
        const layerSystem = app.Drawing.state.layerSystem;
        const layerContainer = layerSystem.container;

        if (layerContainer._originalParent !== undefined) {
            // Restore styles
            layerContainer.style.display = layerContainer._originalDisplay;
            layerContainer.style.position = layerContainer._originalPos;
            layerContainer.style.top = layerContainer._originalTop;
            layerContainer.style.left = layerContainer._originalLeft;
            layerContainer.style.zIndex = layerContainer._originalZIndex;
            layerContainer.style.width = layerContainer._originalWidth;
            layerContainer.style.height = layerContainer._originalHeight;

            // Move back to original parent if necessary
            if (layerContainer._originalParent && layerContainer.parentNode !== layerContainer._originalParent) {
                layerContainer._originalParent.appendChild(layerContainer);
            }

            // Clear temporary properties
            delete layerContainer._originalDisplay;
            delete layerContainer._originalPos;
            // ... delete all other _original* properties ...
            delete layerContainer._originalParent;
            delete layerContainer._tableRef;
        }

        // This is CRUCIAL: after restoring, tell the drawing system to resize 
        // its canvases based on the current (screen) layout of the table.
        if (layerSystem && typeof layerSystem.updateLayoutSize === 'function') {
            layerSystem.updateLayoutSize(); // It should get current table dimensions itself
        }
    }

    app.Export = { init };
    document.addEventListener('DOMContentLoaded', init);

})(window.XSheetApp);